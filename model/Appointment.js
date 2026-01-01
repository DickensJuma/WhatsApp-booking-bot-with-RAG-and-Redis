const mongoose = require("mongoose");

const AppointmentSchema = new mongoose.Schema(
  {
    business_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    service_name: {
      type: String,
      required: true,
    },
    service_duration: {
      type: Number,
      required: true,
    },
    service_price: {
      type: Number,
    },
    appointment_date: {
      type: Date,
      required: true,
    },
    appointment_time: {
      type: String,
      required: true,
    },
    appointment_end_time: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["confirmed", "cancelled", "completed", "no_show"],
      default: "confirmed",
    },
    notes: {
      type: String,
    },
    confirmation_code: {
      type: String,
      index: true,
    },
    reminder_sent: {
      type: Boolean,
      default: false,
    },
    cancellation_reason: {
      type: String,
    },
    cancelled_at: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Database indexes for performance
AppointmentSchema.index({ business_id: 1, appointment_date: 1, status: 1 });
AppointmentSchema.index({ customer_id: 1, appointment_date: -1 });
AppointmentSchema.index({ appointment_date: 1, appointment_time: 1 });
AppointmentSchema.index({ status: 1, appointment_date: 1 });
// confirmation_code already has index: true in schema

const moment = require("moment");

// Instance methods
AppointmentSchema.methods.isUpcoming = function () {
  const now = moment();
  const aptDate = moment(this.appointment_date);
  const aptTime = moment(this.appointment_time, "HH:mm");
  return (
    aptDate.isAfter(now, "day") ||
    (aptDate.isSame(now, "day") && aptTime.isAfter(now))
  );
};

AppointmentSchema.methods.canBeCancelled = function (cancellationHours = 24) {
  const now = moment();
  const aptDateTime = moment(
    `${moment(this.appointment_date).format("YYYY-MM-DD")} ${
      this.appointment_time
    }`,
    "YYYY-MM-DD HH:mm"
  );
  return aptDateTime.diff(now, "hours") >= cancellationHours;
};

AppointmentSchema.methods.getFormattedDate = function () {
  return moment(this.appointment_date).format("MMMM Do, YYYY");
};

AppointmentSchema.methods.getFormattedTime = function () {
  return moment(this.appointment_time, "HH:mm").format("h:mm A");
};

// Static methods
AppointmentSchema.statics.getCustomerAppointments = async function (
  customerId,
  status = null
) {
  const query = { customer_id: customerId };
  if (status) query.status = status;
  return this.find(query).sort({ appointment_date: -1, appointment_time: -1 });
};

AppointmentSchema.statics.checkAvailability = async function (
  businessId,
  date,
  startTime,
  duration,
  excludeAppointmentId = null
) {
  // Find conflicting appointments for the business on the given date and time
  const start = moment(`${date} ${startTime}`, "YYYY-MM-DD HH:mm");
  const end = start.clone().add(duration, "minutes");
  const query = {
    business_id: businessId,
    appointment_date: new Date(date),
    $or: [
      {
        appointment_time: { $lt: end.format("HH:mm") },
        appointment_end_time: { $gt: start.format("HH:mm") },
      },
    ],
    status: "confirmed",
  };
  if (excludeAppointmentId) {
    query._id = { $ne: excludeAppointmentId };
  }
  const conflicts = await this.find(query);
  return { available: conflicts.length === 0, conflicts };
};

AppointmentSchema.statics.getAvailableSlots = async function (
  businessId,
  date,
  serviceDuration = 60,
  bufferTime = 15
) {
  // This is a simplified slot generator for demonstration
  const business = await mongoose.model("Business").findById(businessId);
  if (!business) return [];
  const dayName = moment(date).format("dddd").toLowerCase();
  const hours = business.working_hours[dayName];
  if (!hours || hours.closed) return [];
  const open = moment(hours.open, "HH:mm");
  const close = moment(hours.close, "HH:mm");
  const slots = [];
  let slot = open.clone();
  while (slot.clone().add(serviceDuration, "minutes").isSameOrBefore(close)) {
    // Check for conflicts
    const { available } = await this.checkAvailability(
      businessId,
      date,
      slot.format("HH:mm"),
      serviceDuration
    );
    if (available) {
      slots.push({
        time: slot.format("HH:mm"),
        formatted: slot.format("h:mm A"),
      });
    }
    slot.add(serviceDuration + bufferTime, "minutes");
  }
  return slots;
};

const Appointment = mongoose.model("Appointment", AppointmentSchema);
module.exports = Appointment;
