#!/usr/bin/env node
// Adaptive reschedule simulation: ensures an appointment exists then reschedules it.
require("dotenv").config();
const mongoose = require("mongoose");
const { processIncomingMessage } = require("../services/aiService");
const Business = require("../model/Business");
const Appointment = require("../model/Appointment");

(async () => {
  const phone = "+15550005555";
  const name = "RescheduleUser";
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

    // Ensure a confirmed appointment exists tomorrow 09:00
    const baseDate = new Date(Date.now() + 86400000);
    baseDate.setHours(9, 0, 0, 0);

    // Create via flow if not present for this user
    let existing = await Appointment.findOne({}).populate("customer_id");
    if (
      !existing ||
      (existing.customer_id && existing.customer_id.whatsapp_number !== phone)
    ) {
      const isoDate = baseDate.toISOString().slice(0, 10);
      async function step(msg) {
        return processIncomingMessage({
          messageText: msg,
          customerPhone: phone,
          customerName: name,
          messageId: `r_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        });
      }
      await step("Hi");
      await step(`I want to book a ${service.toLowerCase()}`);
      await step(isoDate);
      await step("09:00");
      existing = await Appointment.findOne({}).populate("customer_id");
      console.log("📅 Created appointment to later reschedule.");
    }

    const newDate = new Date(Date.now() + 3 * 86400000); // +3 days
    const isoNewDate = newDate.toISOString().slice(0, 10);
    const newTime = "11:00";

    async function send(msg) {
      console.log(`👤 ${msg}`);
      const reply = await processIncomingMessage({
        messageText: msg,
        customerPhone: phone,
        customerName: name,
        messageId: `rs_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      });
      console.log("🤖 " + reply.replace(/\n/g, "\n   "));
      return reply;
    }

    console.log("💬 Starting reschedule flow");
    let reply = await send("I want to reschedule my appointment");

    if (/which one/i.test(reply)) {
      reply = await send("1");
    }
    if (/what new date/i.test(reply) || /new date and time/i.test(reply)) {
      reply = await send(`${isoNewDate} ${newTime}`); // simple combined input; may need splitting depending on model
    }

    // If bot asks separately for date
    if (
      !/appointment is confirmed/i.test(reply) &&
      /date/i.test(reply) &&
      !/time/i.test(reply)
    ) {
      reply = await send(isoNewDate);
    }
    if (!/appointment is confirmed/i.test(reply) && /time/i.test(reply)) {
      reply = await send(newTime);
    }

    // Verify there exists an updated appointment after intended date
    const appts = await Appointment.find({}).populate("customer_id");
    const mine = appts.filter(
      (a) => a.customer_id && a.customer_id.whatsapp_number === phone
    );
    const rescheduled = mine.find(
      (a) =>
        a.appointment_date.toISOString().slice(0, 10) === isoNewDate &&
        a.appointment_time.startsWith(newTime)
    );

    if (rescheduled) {
      console.log(`✅ Successfully rescheduled to ${isoNewDate} ${newTime}`);
    } else {
      console.log("⚠️ Reschedule not confirmed.");
    }
  } catch (e) {
    console.error("❌ Reschedule simulation failed:", e.message || e);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
    } catch (_) {}
  }
})();
