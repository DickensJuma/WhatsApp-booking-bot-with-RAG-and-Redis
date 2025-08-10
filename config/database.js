const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

// MongoDB connection URI
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/spark_whatsapp_ai";

mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log("✅ Connected to MongoDB");
    try {
      // Ensure a default business exists
      const Business = require("../model/Business");
      const count = await Business.countDocuments({});
      if (count === 0) {
        await Business.create({
          name: "Spark Beauty & Wellness",
          description: "Appointments via WhatsApp Agent",
          phone: "+254700000000",
          email: "info@spark.local",
          address: "Nairobi, Kenya",
          timezone: "Africa/Nairobi",
          working_hours: {
            monday: { open: "09:00", close: "17:00", closed: false },
            tuesday: { open: "09:00", close: "17:00", closed: false },
            wednesday: { open: "09:00", close: "17:00", closed: false },
            thursday: { open: "09:00", close: "17:00", closed: false },
            friday: { open: "09:00", close: "17:00", closed: false },
            saturday: { open: "10:00", close: "16:00", closed: false },
            sunday: { open: "10:00", close: "16:00", closed: true },
          },
          services: [
            { name: "Haircut", duration: 45, price: 1200 },
            { name: "Manicure", duration: 60, price: 1500 },
            { name: "Pedicure", duration: 60, price: 1800 },
          ],
          buffer_time: 15,
          advance_booking_days: 30,
          cancellation_hours: 24,
          is_active: true,
        });
        console.log("🌱 Seeded default Business document");
      }
    } catch (seedErr) {
      console.warn("⚠️ Could not ensure default business:", seedErr.message);
    }
  })
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Import Mongoose models (to be migrated)
// const Business = require("../model/Business");
// const Appointment = require("../model/Appointment");
// const Customer = require("../model/Customer");

// Associations are handled differently in MongoDB/Mongoose
// (No associations here; handled in Mongoose schemas if needed)

// (Default business creation logic will be handled in Mongoose models/services if needed)
