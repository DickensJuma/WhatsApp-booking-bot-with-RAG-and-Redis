const express = require("express");
const router = express.Router();
const Business = require("../model/Business");
const Customer = require("../model/Customer");
const Appointment = require("../model/Appointment");
const moment = require("moment");
const {
  getAppointmentStats,
  sendTomorrowReminders,
  updateAppointmentStatuses,
} = require("../services/bookingService");

// Get dashboard overview
router.get("/dashboard", async (req, res) => {
  try {
    // Get basic stats
    const totalCustomers = await Customer.countDocuments({ is_active: true });
    const totalAppointments = await Appointment.countDocuments({});

    const todayStart = moment().startOf("day").toDate();
    const todayEnd = moment().endOf("day").toDate();
    const todayAppointments = await Appointment.countDocuments({
      appointment_date: { $gte: todayStart, $lte: todayEnd },
      status: "confirmed",
    });

    const next7Start = moment().startOf("day").toDate();
    const next7End = moment().add(7, "days").endOf("day").toDate();
    const upcomingAppointments = await Appointment.countDocuments({
      appointment_date: { $gte: next7Start, $lte: next7End },
      status: "confirmed",
    });

    // Get recent appointments
    const recentAppointments = await Appointment.find({})
      .limit(10)
      .sort({ createdAt: -1 })
      .populate("customer_id", "name whatsapp_number");

    // Get business info
    const business = await Business.findOne({ is_active: true });

    res.json({
      success: true,
      data: {
        stats: {
          totalCustomers,
          totalAppointments,
          todayAppointments,
          upcomingAppointments,
        },
        recentAppointments: recentAppointments.map((apt) => ({
          id: apt.id,
          service: apt.service_name,
          date: apt.getFormattedDate(),
          time: apt.getFormattedTime(),
          status: apt.status,
          customer: apt.customer_id
            ? apt.customer_id.name || apt.customer_id.whatsapp_number
            : "Unknown",
          customerPhone: apt.customer_id
            ? apt.customer_id.whatsapp_number
            : null,
          confirmationCode: apt.confirmation_code,
          createdAt: apt.createdAt,
        })),
        business: business
          ? {
              name: business.name,
              services: business.services,
              workingHours: business.working_hours,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("❌ Dashboard error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to load dashboard data",
    });
  }
});

// Get all appointments
router.get("/appointments", async (req, res) => {
  try {
    const { page = 1, limit = 20, status, date } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter
    const filter = {};
    if (status) filter.status = status;
    if (date) {
      const dStart = moment(date, "YYYY-MM-DD").startOf("day").toDate();
      const dEnd = moment(date, "YYYY-MM-DD").endOf("day").toDate();
      filter.appointment_date = { $gte: dStart, $lte: dEnd };
    }

    const [count, rows] = await Promise.all([
      Appointment.countDocuments(filter),
      Appointment.find(filter)
        .sort({ appointment_date: -1, appointment_time: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("customer_id", "id name whatsapp_number email")
        .populate("business_id", "id name"),
    ]);

    res.json({
      success: true,
      data: {
        appointments: rows.map((apt) => ({
          id: apt.id,
          service: apt.service_name,
          duration: apt.service_duration,
          price: apt.service_price,
          date: apt.appointment_date,
          time: apt.appointment_time,
          endTime: apt.appointment_end_time,
          formattedDate: apt.getFormattedDate(),
          formattedTime: apt.getFormattedTime(),
          status: apt.status,
          notes: apt.notes,
          confirmationCode: apt.confirmation_code,
          customer: apt.customer_id
            ? {
                id: apt.customer_id.id,
                name: apt.customer_id.name || apt.customer_id.whatsapp_number,
                phone: apt.customer_id.whatsapp_number,
                email: apt.customer_id.email,
              }
            : null,
          business: apt.business_id ? apt.business_id.name : null,
          createdAt: apt.createdAt,
          updatedAt: apt.updatedAt,
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          totalPages: Math.ceil(count / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("❌ Get appointments error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve appointments",
    });
  }
});

// Get appointment by ID
router.get("/appointments/:id", async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id)
      .populate("customer_id")
      .populate("business_id");

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: "Appointment not found",
      });
    }

    res.json({
      success: true,
      data: {
        id: appointment.id,
        service: appointment.service_name,
        duration: appointment.service_duration,
        price: appointment.service_price,
        date: appointment.appointment_date,
        time: appointment.appointment_time,
        endTime: appointment.appointment_end_time,
        formattedDate: appointment.getFormattedDate(),
        formattedTime: appointment.getFormattedTime(),
        status: appointment.status,
        notes: appointment.notes,
        confirmationCode: appointment.confirmation_code,
        customer: appointment.customer_id
          ? {
              id: appointment.customer_id.id,
              name:
                appointment.customer_id.name ||
                appointment.customer_id.whatsapp_number,
              phone: appointment.customer_id.whatsapp_number,
              email: appointment.customer_id.email,
            }
          : null,
        business: appointment.business_id ? appointment.business_id.name : null,
        createdAt: appointment.createdAt,
        updatedAt: appointment.updatedAt,
        canBeCancelled: appointment.canBeCancelled(),
      },
    });
  } catch (error) {
    console.error("❌ Get appointment error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve appointment",
    });
  }
});

// Update appointment status
router.patch("/appointments/:id/status", async (req, res) => {
  try {
    const { status, reason } = req.body;
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: "Appointment not found",
      });
    }

    if (status === "cancelled") {
      appointment.status = "cancelled";
      appointment.cancellation_reason = reason;
      appointment.cancelled_at = new Date();
      await appointment.save();
    } else {
      appointment.status = status;
      await appointment.save();
    }

    res.json({
      success: true,
      message: "Appointment status updated successfully",
      data: {
        id: appointment.id,
        status: appointment.status,
        updatedAt: appointment.updatedAt,
      },
    });
  } catch (error) {
    console.error("❌ Update appointment status error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update appointment status",
    });
  }
});

// Get all customers
router.get("/customers", async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter for search
    const filter = { is_active: true };
    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { name: regex },
        { whatsapp_number: regex },
        { email: regex },
      ];
    }

    const [count, rows] = await Promise.all([
      Customer.countDocuments(filter),
      Customer.find(filter)
        .sort({ last_interaction: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
    ]);

    // Fetch recent appointments per customer (up to 5)
    const customerIds = rows.map((c) => c.id);
    const recentAptsByCustomer = {};
    const recentAppointments = await Appointment.find({
      customer_id: { $in: customerIds },
    })
      .sort({ appointment_date: -1 })
      .limit(5 * rows.length);
    for (const apt of recentAppointments) {
      const cid = apt.customer_id.toString();
      if (!recentAptsByCustomer[cid]) recentAptsByCustomer[cid] = [];
      if (recentAptsByCustomer[cid].length < 5)
        recentAptsByCustomer[cid].push({
          id: apt.id,
          status: apt.status,
          appointment_date: apt.appointment_date,
        });
    }

    res.json({
      success: true,
      data: {
        customers: rows.map((customer) => ({
          id: customer.id,
          name: customer.name || customer.whatsapp_number,
          phone: customer.whatsapp_number,
          email: customer.email,
          totalAppointments: customer.total_appointments,
          lastInteraction: customer.last_interaction,
          recentAppointments: recentAptsByCustomer[customer.id] || [],
          createdAt: customer.createdAt,
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          totalPages: Math.ceil(count / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("❌ Get customers error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve customers",
    });
  }
});

// Get available time slots for a specific date
router.get("/availability/:date", async (req, res) => {
  try {
    const { date } = req.params;
    const { service } = req.query;

    // Validate date
    if (!moment(date, "YYYY-MM-DD", true).isValid()) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    const business = await Business.findOne({ is_active: true });
    if (!business) {
      return res.status(404).json({
        success: false,
        error: "Business not found",
      });
    }

    let serviceDuration = 60; // default
    if (service) {
      const serviceObj = business.getServiceByName(service);
      if (serviceObj) {
        serviceDuration = serviceObj.duration;
      }
    }

    const availableSlots = await Appointment.getAvailableSlots(
      business.id,
      date,
      serviceDuration,
      business.buffer_time
    );

    res.json({
      success: true,
      data: {
        date,
        service,
        duration: serviceDuration,
        bufferTime: business.buffer_time,
        availableSlots,
      },
    });
  } catch (error) {
    console.error("❌ Get availability error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve availability",
    });
  }
});

// Get business configuration
router.get("/business", async (req, res) => {
  try {
    const business = await Business.findOne({ is_active: true });

    if (!business) {
      return res.status(404).json({
        success: false,
        error: "Business not found",
      });
    }

    res.json({
      success: true,
      data: {
        id: business.id,
        name: business.name,
        description: business.description,
        phone: business.phone,
        email: business.email,
        address: business.address,
        timezone: business.timezone,
        workingHours: business.working_hours,
        services: business.services,
        bufferTime: business.buffer_time,
        advanceBookingDays: business.advance_booking_days,
        cancellationHours: business.cancellation_hours,
      },
    });
  } catch (error) {
    console.error("❌ Get business error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to retrieve business information",
    });
  }
});

// Get aggregated appointment stats
router.get("/stats", async (req, res) => {
  try {
    const business = await Business.findOne({ is_active: true });
    if (!business) {
      return res
        .status(404)
        .json({ success: false, error: "Business not found" });
    }

    const { startDate, endDate } = req.query;
    const stats = await getAppointmentStats(business.id, startDate, endDate);
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error("❌ Get stats error:", error);
    res.status(500).json({ success: false, error: "Failed to retrieve stats" });
  }
});

// Trigger sending reminders for tomorrow's appointments
router.post("/maintenance/reminders", async (req, res) => {
  try {
    const result = await sendTomorrowReminders();
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("❌ Send reminders error:", error);
    res.status(500).json({ success: false, error: "Failed to send reminders" });
  }
});

// Update appointment statuses (e.g., mark yesterday's as no-show)
router.post("/maintenance/update-statuses", async (req, res) => {
  try {
    const result = await updateAppointmentStatuses();
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("❌ Update statuses error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to update statuses" });
  }
});

// Health check for admin panel
router.get("/health", (req, res) => {
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    service: "Spark WhatsApp AI - Admin Panel",
  });
});

module.exports = router;
