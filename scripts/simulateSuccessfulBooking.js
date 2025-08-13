#!/usr/bin/env node
// Simulate a full successful booking conversation.
// Assumptions: Business has a service named 'Facial' (case-insensitive) and working hours include chosen slot.
// Run seed script then (if needed) patch business to include Facial.
require("dotenv").config();
const mongoose = require("mongoose");
const { processIncomingMessage } = require("../services/aiService");
const Business = require("../model/Business");
const Appointment = require("../model/Appointment");

(async () => {
  const phone = "+15550001234";
  const name = "BookingTester";
  try {
    const uri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/spark_whatsapp_ai";
    await mongoose.connect(uri);
    console.log("✅ Mongo connected");

    const business = await Business.getDefaultBusiness();
    if (!business) {
      console.error("❌ No business found. Run: npm run seed:local");
      process.exit(1);
    }

    // Ensure 'Facial' service exists; if not, add it.
    if (!business.getServiceByName("Facial")) {
      business.services.push({ name: "Facial", duration: 60, price: 3000 });
      await business.save();
      console.log("🆕 Added Facial service for simulation");
    }

    // Choose a target date (tomorrow) and time (10:00) likely free.
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const isoTomorrow = tomorrow.toISOString().slice(0, 10);

    // Conversation script with placeholders replaced dynamically.
    const script = [
      "Hi",
      "I want to book a facial",
      isoTomorrow, // explicit date to avoid relative parsing edge cases
      "10:00",
      "Yes that works",
      "Thanks",
    ];

    console.log("\n💬 Successful booking simulation starting...\n");

    for (const userMsg of script) {
      console.log(`👤 User: ${userMsg}`);
      const reply = await processIncomingMessage({
        messageText: userMsg,
        customerPhone: phone,
        customerName: name,
        messageId: `sim_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      });
      console.log(`🤖 Bot: ${reply}\n`);
    }

    // Show resulting appointment(s) for this user
    const appointments = await Appointment.find({}).populate("customer_id");
    const userApts = appointments.filter(
      (a) => a.customer_id && a.customer_id.whatsapp_number === phone
    );
    if (userApts.length) {
      console.log("📅 Created Appointments:");
      for (const apt of userApts) {
        console.log(
          ` - ${
            apt.service_name
          } on ${apt.getFormattedDate()} at ${apt.getFormattedTime()} | Status: ${
            apt.status
          } | Code: ${apt.confirmation_code}`
        );
      }
    } else {
      console.log("⚠️ No appointments created (flow may not have finalized).");
    }

    console.log("\n✅ Successful booking simulation complete");
  } catch (e) {
    console.error("❌ Simulation failed:", e.message || e);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
    } catch (_) {}
  }
})();
