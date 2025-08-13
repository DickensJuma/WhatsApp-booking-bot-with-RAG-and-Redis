#!/usr/bin/env node
// Adaptive cancellation simulation: ensures an appointment exists then cancels it if allowed.
require("dotenv").config();
const mongoose = require("mongoose");
const { processIncomingMessage } = require("../services/aiService");
const Business = require("../model/Business");
const Appointment = require("../model/Appointment");
const Customer = require("../model/Customer");

(async () => {
  const phone = "+15550006666";
  const name = "CancelUser";
  const service = "Facial";
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/spark_whatsapp_ai"
    );
    const business = await Business.getDefaultBusiness();
    if (!business) throw new Error("No business config. Seed first.");
    if (!business.getServiceByName(service)) {
      business.services.push({ name: service, duration: 60, price: 3000 });
      await business.save();
    }

    // Ensure a confirmed future appointment exists today+2 days 09:00
    const futureDate = new Date(Date.now() + 2 * 86400000); // +2 days
    futureDate.setHours(9, 0, 0, 0);
    let user = await Customer.findOne({ whatsapp_number: phone });
    let appt = null;
    if (user) {
      appt = await Appointment.findOne({ customer_id: user._id }).populate(
        "customer_id"
      );
    }
    if (!appt) {
      // Build minimal creation via booking flow process to keep logic uniform
      const isoDate = futureDate.toISOString().slice(0, 10);
      async function step(msg) {
        const r = await processIncomingMessage({
          messageText: msg,
          customerPhone: phone,
          customerName: name,
          messageId: `c_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        });
        return r;
      }
      await step("Hi");
      await step(`I want to book a ${service.toLowerCase()}`);
      await step(isoDate);
      await step("09:00");
      user = await Customer.findOne({ whatsapp_number: phone });
      appt = await Appointment.findOne({ customer_id: user._id }).populate(
        "customer_id"
      );
      console.log("📅 Created appointment to later cancel.");
    }

    async function send(msg) {
      console.log(`👤 ${msg}`);
      const reply = await processIncomingMessage({
        messageText: msg,
        customerPhone: phone,
        customerName: name,
        messageId: `ca_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      });
      console.log("🤖 " + reply.replace(/\n/g, "\n   "));
      return reply;
    }

    console.log("💬 Starting cancellation flow");
    // Initiate cancellation intent
    let reply = await send("I want to cancel my appointment");

    if (/are you sure/i.test(reply)) {
      reply = await send("yes");
    } else if (/which one/i.test(reply)) {
      reply = await send("1");
      if (/are you sure/i.test(reply)) reply = await send("yes");
    }

    // Allow async processing to persist cancellation
    await new Promise((r) => setTimeout(r, 100));
    console.log("🔍 Checking updated appointment status...");
    const allMine = await Appointment.find({ customer_id: user._id }).sort({
      createdAt: 1,
    });
    const cancelled = allMine.filter((a) => a.status === "cancelled");
    allMine.forEach((a) =>
      console.log(
        ` • Appointment ${a._id} ${a.service_name} ${a.appointment_time} status=${a.status}`
      )
    );
    if (cancelled.length) {
      console.log(
        `✅ Cancelled count: ${cancelled.length}. Most recent code: ${
          cancelled[cancelled.length - 1].confirmation_code
        }`
      );
    } else {
      console.log("⚠️ No cancelled appointments detected for user.");
    }
  } catch (e) {
    console.error("❌ Cancellation simulation failed:", e.message || e);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
    } catch (_) {}
  }
})();
