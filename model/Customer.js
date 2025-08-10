const mongoose = require("mongoose");

const CustomerSchema = new mongoose.Schema(
  {
    whatsapp_number: {
      type: String,
      required: true,
      unique: true,
      match: /^\+?[1-9]\d{1,14}$/,
    },
    name: {
      type: String,
      maxlength: 255,
    },
    email: {
      type: String,
      match: /.+@.+\..+/,
    },
    preferred_language: {
      type: String,
      default: "en",
    },
    conversation_context: {
      type: Object,
    },
    last_interaction: {
      type: Date,
    },
    total_appointments: {
      type: Number,
      default: 0,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

const Customer = mongoose.model("Customer", CustomerSchema);

module.exports = Customer;
