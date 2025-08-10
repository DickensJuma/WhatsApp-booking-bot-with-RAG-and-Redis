const moment = require("moment");
const Appointment = require("../model/Appointment");
const Business = require("../model/Business");
const Customer = require("../model/Customer");
const {
  sendAppointmentConfirmation,
  sendCancellationConfirmation,
} = require("./whatsappService");

function generateConfirmationCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Create a new appointment
async function createAppointment({
  customerId,
  businessId,
  service,
  date,
  time,
  notes = null,
}) {
  try {
    console.log(`📅 Creating appointment for customer ${customerId}`);

    // Validate inputs
    if (!customerId || !businessId || !service || !date || !time) {
      throw new Error("Missing required appointment data");
    }

    // Get business for validation
    const business = await Business.findById(businessId);
    if (!business) {
      throw new Error("Business not found");
    }

    // Get customer for notifications
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new Error("Customer not found");
    }

    // Validate date
    const appointmentDate = moment(date);
    const today = moment();

    if (!appointmentDate.isValid()) {
      throw new Error("Invalid appointment date");
    }

    if (appointmentDate.isBefore(today, "day")) {
      throw new Error("Cannot book appointments in the past");
    }

    // Check if business is open on this day
    const dayName = appointmentDate.format("dddd").toLowerCase();
    const workingHours = business.getWorkingHoursForDay(dayName);

    if (!workingHours || workingHours.closed) {
      throw new Error(
        `Business is closed on ${appointmentDate.format("dddd")}s`
      );
    }

    // Validate time is within working hours
    const appointmentTime = moment(time, "HH:mm");
    const openTime = moment(workingHours.open, "HH:mm");
    const closeTime = moment(workingHours.close, "HH:mm");
    const serviceEndTime = appointmentTime
      .clone()
      .add(service.duration, "minutes");

    if (
      appointmentTime.isBefore(openTime) ||
      serviceEndTime.isAfter(closeTime)
    ) {
      throw new Error(
        `Appointment time is outside business hours (${workingHours.open} - ${workingHours.close})`
      );
    }

    // Check availability
    const availability = await Appointment.checkAvailability(
      businessId,
      date,
      time,
      service.duration
    );

    if (!availability.available) {
      throw new Error("Time slot is not available");
    }

    // Calculate end time
    const appointmentEndTime = moment(time, "HH:mm")
      .clone()
      .add(service.duration, "minutes")
      .format("HH:mm");

    // Create the appointment
    const appointment = await Appointment.create({
      business_id: businessId,
      customer_id: customerId,
      service_name: service.name,
      service_duration: service.duration,
      service_price: service.price,
      appointment_date: new Date(date),
      appointment_time: time,
      appointment_end_time: appointmentEndTime,
      status: "confirmed",
      notes: notes,
      confirmation_code: generateConfirmationCode(),
      reminder_sent: false,
    });

    console.log(`✅ Appointment created with ID: ${appointment._id}`);

    // Update customer appointment count
    customer.total_appointments = (customer.total_appointments || 0) + 1;
    await customer.save();

    // Send confirmation to customer
    try {
      await sendAppointmentConfirmation(
        customer.whatsapp_number,
        appointment,
        business
      );
    } catch (notificationError) {
      console.error(
        "⚠️ Failed to send appointment confirmation:",
        notificationError.message
      );
      // Don't fail the appointment creation if notification fails
    }

    return appointment;
  } catch (error) {
    console.error("❌ Error creating appointment:", error);
    throw error;
  }
}

// Reschedule an existing appointment
async function rescheduleAppointment(
  appointmentId,
  newDate,
  newTime,
  reason = null
) {
  try {
    console.log(`🔄 Rescheduling appointment ${appointmentId}`);

    const appointment = await Appointment.findById(appointmentId)
      .populate("customer_id")
      .populate("business_id");

    if (!appointment) {
      throw new Error("Appointment not found");
    }

    if (appointment.status !== "confirmed") {
      throw new Error("Can only reschedule confirmed appointments");
    }

    // Validate new date/time
    const newAppointmentDate = moment(newDate);
    const today = moment();

    if (
      !newAppointmentDate.isValid() ||
      newAppointmentDate.isBefore(today, "day")
    ) {
      throw new Error("Invalid new appointment date");
    }

    // Check availability for new slot
    const availability = await Appointment.checkAvailability(
      appointment.business_id,
      newDate,
      newTime,
      appointment.service_duration,
      appointmentId // Exclude current appointment from availability check
    );

    if (!availability.available) {
      throw new Error("New time slot is not available");
    }

    // Check business hours for new slot
    const business = appointment.business;
    const dayName = newAppointmentDate.format("dddd").toLowerCase();
    const workingHours = business.getWorkingHoursForDay(dayName);

    if (!workingHours || workingHours.closed) {
      throw new Error(
        `Business is closed on ${newAppointmentDate.format("dddd")}s`
      );
    }

    const newAppointmentTime = moment(newTime, "HH:mm");
    const openTime = moment(workingHours.open, "HH:mm");
    const closeTime = moment(workingHours.close, "HH:mm");
    const serviceEndTime = newAppointmentTime
      .clone()
      .add(appointment.service_duration, "minutes");

    if (
      newAppointmentTime.isBefore(openTime) ||
      serviceEndTime.isAfter(closeTime)
    ) {
      throw new Error("New appointment time is outside business hours");
    }

    // Update appointment
    const oldDate = appointment.getFormattedDate();
    const oldTime = appointment.getFormattedTime();

    appointment.appointment_date = new Date(newDate);
    appointment.appointment_time = newTime;
    appointment.appointment_end_time = serviceEndTime.format("HH:mm");
    appointment.notes = appointment.notes
      ? `${
          appointment.notes
        }\n\nRescheduled from ${oldDate} ${oldTime}. Reason: ${
          reason || "Customer request"
        }`
      : `Rescheduled from ${oldDate} ${oldTime}. Reason: ${
          reason || "Customer request"
        }`;

    await appointment.save();

    console.log(`✅ Appointment ${appointmentId} rescheduled successfully`);

    // Send confirmation
    try {
      const message = `✅ **Appointment Rescheduled**

Your ${appointment.service_name} appointment has been moved to:

📅 **New Date & Time:**
${appointment.getFormattedDate()} at ${appointment.getFormattedTime()}

📋 **Details:**
• Service: ${appointment.service_name}
• Duration: ${appointment.service_duration} minutes
• Price: KSH ${appointment.service_price}
• Confirmation Code: ${appointment.confirmation_code}

Thank you! 😊`;

      await require("./whatsappService").sendWhatsAppMessage(
        appointment.customer_id.whatsapp_number,
        message
      );
    } catch (notificationError) {
      console.error(
        "⚠️ Failed to send reschedule confirmation:",
        notificationError.message
      );
    }

    return appointment;
  } catch (error) {
    console.error("❌ Error rescheduling appointment:", error);
    throw error;
  }
}

// Cancel an appointment
async function cancelAppointment(appointmentId, reason = null) {
  try {
    console.log(`❌ Cancelling appointment ${appointmentId}`);

    const appointment = await Appointment.findById(appointmentId)
      .populate("customer_id")
      .populate("business_id");

    if (!appointment) {
      throw new Error("Appointment not found");
    }

    if (appointment.status !== "confirmed") {
      throw new Error("Can only cancel confirmed appointments");
    }

    // Check if appointment can be cancelled (within cancellation policy)
    const business = appointment.business;
    if (!appointment.canBeCancelled(business.cancellation_hours)) {
      throw new Error(
        `Appointments must be cancelled at least ${business.cancellation_hours} hours in advance`
      );
    }

    // Cancel the appointment
    appointment.status = "cancelled";
    appointment.cancellation_reason = reason;
    appointment.cancelled_at = new Date();
    await appointment.save();

    console.log(`✅ Appointment ${appointmentId} cancelled successfully`);

    // Send cancellation confirmation
    try {
      await sendCancellationConfirmation(
        appointment.customer_id.whatsapp_number,
        appointment
      );
    } catch (notificationError) {
      console.error(
        "⚠️ Failed to send cancellation confirmation:",
        notificationError.message
      );
    }

    return appointment;
  } catch (error) {
    console.error("❌ Error cancelling appointment:", error);
    throw error;
  }
}

// Get available time slots for a specific date and service
async function getAvailableSlots(businessId, date, serviceName = null) {
  try {
    const business = await Business.findById(businessId);
    if (!business) {
      throw new Error("Business not found");
    }

    let serviceDuration = 60; // Default duration

    if (serviceName) {
      const service = business.getServiceByName(serviceName);
      if (service) {
        serviceDuration = service.duration;
      }
    }

    const slots = await Appointment.getAvailableSlots(
      businessId,
      date,
      serviceDuration,
      business.buffer_time
    );

    return {
      date,
      serviceName,
      serviceDuration,
      bufferTime: business.buffer_time,
      totalSlots: slots.length,
      availableSlots: slots,
    };
  } catch (error) {
    console.error("❌ Error getting available slots:", error);
    throw error;
  }
}

// Get appointment statistics
async function getAppointmentStats(
  businessId,
  startDate = null,
  endDate = null
) {
  try {
    // Set default date range if not provided
    if (!startDate)
      startDate = moment().subtract(30, "days").format("YYYY-MM-DD");
    if (!endDate) endDate = moment().format("YYYY-MM-DD");

    const start = new Date(startDate);
    const end = new Date(endDate);

    const match = {
      business_id: new (require("mongoose").Types.ObjectId)(businessId),
      appointment_date: { $gte: start, $lte: end },
    };

    const totalAppointments = await Appointment.countDocuments(match);

    const statusAgg = await Appointment.aggregate([
      { $match: match },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const revenueAgg = await Appointment.aggregate([
      { $match: { ...match, status: { $in: ["confirmed", "completed"] } } },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ["$service_price", 0] } },
        },
      },
    ]);

    const popularServicesAgg = await Appointment.aggregate([
      { $match: match },
      { $group: { _id: "$service_name", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    const dailyBookingsAgg = await Appointment.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$appointment_date" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return {
      period: { startDate, endDate },
      totalAppointments,
      totalRevenue: parseFloat(revenueAgg[0]?.total || 0),
      statusBreakdown: statusAgg.reduce((acc, s) => {
        acc[s._id] = s.count;
        return acc;
      }, {}),
      popularServices: popularServicesAgg.map((s) => ({
        name: s._id,
        count: s.count,
      })),
      dailyBookings: dailyBookingsAgg.map((d) => ({
        date: d._id,
        count: d.count,
      })),
    };
  } catch (error) {
    console.error("❌ Error getting appointment stats:", error);
    throw error;
  }
}

// Send appointment reminders for tomorrow's appointments
async function sendTomorrowReminders() {
  try {
    const start = moment().add(1, "day").startOf("day").toDate();
    const end = moment().add(1, "day").endOf("day").toDate();
    const appointments = await Appointment.find({
      appointment_date: { $gte: start, $lte: end },
      status: "confirmed",
      reminder_sent: false,
    })
      .populate("customer_id")
      .populate("business_id");

    console.log(
      `📤 Sending reminders for ${appointments.length} appointments tomorrow`
    );

    let successCount = 0;
    let failureCount = 0;

    for (const appointment of appointments) {
      try {
        await require("./whatsappService").sendAppointmentReminder(
          appointment.customer_id.whatsapp_number,
          appointment,
          appointment.business_id
        );

        // Mark reminder as sent
        appointment.reminder_sent = true;
        await appointment.save();

        successCount++;
        console.log(`✅ Reminder sent for appointment ${appointment.id}`);
      } catch (error) {
        failureCount++;
        console.error(
          `❌ Failed to send reminder for appointment ${appointment.id}:`,
          error.message
        );
      }
    }

    return {
      totalAppointments: appointments.length,
      successCount,
      failureCount,
    };
  } catch (error) {
    console.error("❌ Error sending tomorrow reminders:", error);
    throw error;
  }
}

// Check and update appointment statuses (mark as no-show if past appointment time)
async function updateAppointmentStatuses() {
  try {
    const start = moment().subtract(1, "day").startOf("day").toDate();
    const end = moment().subtract(1, "day").endOf("day").toDate();
    const appointments = await Appointment.find({
      appointment_date: { $gte: start, $lte: end },
      status: "confirmed",
    });

    let updatedCount = 0;

    for (const appointment of appointments) {
      // Mark as no-show if appointment was yesterday and still confirmed
      appointment.status = "no_show";
      await appointment.save();
      updatedCount++;

      console.log(`📋 Marked appointment ${appointment.id} as no-show`);
    }

    return {
      checkedDate: moment(start).format("YYYY-MM-DD"),
      updatedCount,
    };
  } catch (error) {
    console.error("❌ Error updating appointment statuses:", error);
    throw error;
  }
}

// Validate appointment data
function validateAppointmentData({
  service,
  date,
  time,
  customerId,
  businessId,
}) {
  const errors = [];

  if (!customerId) {
    errors.push("Customer ID is required");
  }

  if (!businessId) {
    errors.push("Business ID is required");
  }

  if (!service || !service.name || !service.duration) {
    errors.push("Valid service information is required");
  }

  if (!date) {
    errors.push("Appointment date is required");
  } else {
    const appointmentDate = moment(date);
    if (!appointmentDate.isValid()) {
      errors.push("Invalid appointment date format");
    } else if (appointmentDate.isBefore(moment(), "day")) {
      errors.push("Cannot book appointments in the past");
    }
  }

  if (!time) {
    errors.push("Appointment time is required");
  } else {
    const appointmentTime = moment(time, "HH:mm");
    if (!appointmentTime.isValid()) {
      errors.push("Invalid appointment time format");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// Get customer's appointment history
async function getCustomerAppointmentHistory(customerId, limit = 10) {
  try {
    const appointments = await Appointment.find({ customer_id: customerId })
      .populate("business_id")
      .sort({ appointment_date: -1, appointment_time: -1 })
      .limit(limit);

    return appointments.map((apt) => ({
      id: apt.id,
      service: apt.service_name,
      date: apt.getFormattedDate(),
      time: apt.getFormattedTime(),
      status: apt.status,
      price: apt.service_price,
      confirmationCode: apt.confirmation_code,
      business: apt.business_id ? apt.business_id.name : null,
      createdAt: apt.createdAt,
    }));
  } catch (error) {
    console.error("❌ Error getting customer appointment history:", error);
    throw error;
  }
}

// Find appointments by confirmation code
async function findAppointmentByConfirmationCode(confirmationCode) {
  try {
    const appointment = await Appointment.findOne({
      confirmation_code: confirmationCode.toUpperCase(),
    })
      .populate("customer_id")
      .populate("business_id");

    if (!appointment) {
      return null;
    }

    return {
      id: appointment.id,
      service: appointment.service_name,
      duration: appointment.service_duration,
      price: appointment.service_price,
      date: appointment.getFormattedDate(),
      time: appointment.getFormattedTime(),
      status: appointment.status,
      confirmationCode: appointment.confirmation_code,
      customer: {
        name:
          appointment.customer_id.name ||
          appointment.customer_id.whatsapp_number,
        phone: appointment.customer_id.whatsapp_number,
      },
      business: appointment.business_id ? appointment.business_id.name : null,
      canBeCancelled: appointment.canBeCancelled(),
      isUpcoming: appointment.isUpcoming(),
    };
  } catch (error) {
    console.error("❌ Error finding appointment by confirmation code:", error);
    throw error;
  }
}

module.exports = {
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
  getAvailableSlots,
  getAppointmentStats,
  sendTomorrowReminders,
  updateAppointmentStatuses,
  validateAppointmentData,
  getCustomerAppointmentHistory,
  findAppointmentByConfirmationCode,
};
