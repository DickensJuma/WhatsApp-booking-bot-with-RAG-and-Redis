#!/usr/bin/env node
// Local seed script: creates business config + sample services + FAQ chunks if they don't exist.
// Safe to run multiple times (idempotent where possible).
require("dotenv").config();
const mongoose = require("mongoose");
const Business = require("../model/Business");
const FAQChunk = require("../model/FAQChunk");

(async () => {
  try {
    const uri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/spark_whatsapp_ai";
    await mongoose.connect(uri);
    console.log("✅ Connected Mongo for seeding");

    let business = await Business.findOne({ is_active: true });
    if (!business) {
      business = await Business.create({
        name: process.env.BUSINESS_NAME || "Local Salon",
        timezone: process.env.BUSINESS_TIMEZONE || "Africa/Nairobi",
        services: [
          { name: "Facial", duration: 60, price: 3000 },
          { name: "Hair Cut", duration: 30, price: 1500 },
          { name: "Massage", duration: 45, price: 4000 },
        ],
        working_hours: {
          monday: { open: "09:00", close: "17:00", closed: false },
          tuesday: { open: "09:00", close: "17:00", closed: false },
          wednesday: { open: "09:00", close: "17:00", closed: false },
          thursday: { open: "09:00", close: "17:00", closed: false },
          friday: { open: "09:00", close: "17:00", closed: false },
          saturday: { open: "10:00", close: "15:00", closed: false },
          sunday: { closed: true },
        },
        buffer_time: 15,
        advance_booking_days: 30,
        cancellation_hours: 24,
      });
      console.log("🆕 Created business config");
    } else {
      // Ensure services populated
      if (!business.services || business.services.length === 0) {
        business.services = [
          { name: "Facial", duration: 60, price: 3000 },
          { name: "Hair Cut", duration: 30, price: 1500 },
        ];
        await business.save();
        console.log("🔄 Updated existing business with default services");
      } else {
        console.log("ℹ️ Business already exists");
      }
    }

    // Seed a few FAQ chunks if none
    const faqCount = await FAQChunk.countDocuments({
      business_id: business.id,
    });
    if (faqCount === 0) {
      const faqs = [
        {
          title: "Cancellation Policy",
          text: "Please cancel at least 6 hours before your appointment to avoid fees.",
          source: "policy",
        },
        {
          title: "Payment Methods",
          text: "We accept M-Pesa and cash on arrival.",
          source: "payments",
        },
        {
          title: "Location",
          text: "We are located in Nairobi CBD, 2nd Floor, Suite 5.",
          source: "location",
        },
      ];
      for (const f of faqs) {
        await FAQChunk.create({ business_id: business.id, ...f, metadata: {} });
      }
      console.log("🆕 Seeded FAQ chunks");
    } else {
      console.log(`ℹ️ ${faqCount} FAQ chunks already present`);
    }

    console.log("✅ Seed complete");
    await mongoose.disconnect();
  } catch (e) {
    console.error("❌ Seed failed", e);
    process.exitCode = 1;
  }
})();
