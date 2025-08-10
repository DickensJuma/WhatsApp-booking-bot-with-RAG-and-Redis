const mongoose = require("mongoose");

const BusinessSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    description: {
      type: String,
    },
    phone: {
      type: String,
    },
    email: {
      type: String,
      match: /.+@.+\..+/,
    },
    address: {
      type: String,
    },
    timezone: {
      type: String,
      required: true,
      default: "Africa/Nairobi",
    },
    working_hours: {
      type: Object,
      required: true,
      default: () => ({
        monday: { open: "09:00", close: "17:00", closed: false },
        tuesday: { open: "09:00", close: "17:00", closed: false },
        wednesday: { open: "09:00", close: "17:00", closed: false },
        thursday: { open: "09:00", close: "17:00", closed: false },
        friday: { open: "09:00", close: "17:00", closed: false },
        saturday: { open: "10:00", close: "16:00", closed: false },
        sunday: { open: "10:00", close: "16:00", closed: true },
      }),
    },
    services: {
      type: [Object],
      default: [],
    },
    buffer_time: {
      type: Number,
      default: 15,
    },
    advance_booking_days: {
      type: Number,
      default: 30,
    },
    cancellation_hours: {
      type: Number,
      default: 24,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Add static and instance methods for compatibility
BusinessSchema.statics.getDefaultBusiness = async function () {
  // Returns the first business document (customize as needed)
  return this.findOne();
};

BusinessSchema.methods.getServiceByName = function (serviceName) {
  if (!this.services) return null;
  return this.services.find(
    (service) =>
      service.name && service.name.toLowerCase() === serviceName.toLowerCase()
  );
};

BusinessSchema.methods.getAllServiceNames = function () {
  if (!this.services) return [];
  return this.services.map((service) => service.name);
};

BusinessSchema.methods.isWorkingDay = function (dayName) {
  if (!this.working_hours) return false;
  const hours = this.working_hours[dayName.toLowerCase()];
  return hours && !hours.closed;
};

// Convenience helper used by services
BusinessSchema.methods.getWorkingHoursForDay = function (dayName) {
  if (!this.working_hours) return null;
  return this.working_hours[dayName.toLowerCase()] || null;
};

const Business = mongoose.model("Business", BusinessSchema);
module.exports = Business;
