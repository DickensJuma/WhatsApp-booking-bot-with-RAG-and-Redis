#!/usr/bin/env node
// Adaptive simulation: drives the booking flow until an appointment is confirmed.
require("dotenv").config();
const mongoose = require("mongoose");
const { processIncomingMessage } = require("../services/aiService");
const Business = require("../model/Business");
const Appointment = require("../model/Appointment");

async function ensureService(business, name, duration = 60, price = 3000) {
  if (!business.getServiceByName(name)) {
    business.services.push({ name, duration, price });
    await business.save();
  }
}

(async () => {
  const phone = "+15550007777";
  const name = "AdaptiveUser";
  const targetService = "Facial";
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/spark_whatsapp_ai"
    );
    const business = await Business.getDefaultBusiness();
    if (!business)
      throw new Error("No business config. Run seed script first.");
    await ensureService(business, targetService);

    const today = new Date();
    const tomorrow = new Date(today.getTime() + 86400000);
    const isoTomorrow = tomorrow.toISOString().slice(0, 10);
    const preferredTime = "10:00";

    console.log("💬 Starting adaptive booking flow");

    async function send(msg) {
      console.log(`👤 ${msg}`);
      const reply = await processIncomingMessage({
        messageText: msg,
        customerPhone: phone,
        customerName: name,
        messageId: `ad_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      });
      console.log("🤖 " + reply.replace(/\n/g, "\n   "));
      return reply;
    }

    await send("Hi");
    let reply = await send(`I want to book a ${targetService.toLowerCase()}`);

    if (/what date|which date|preferred date/i.test(reply)) {
      reply = await send(isoTomorrow);
    }
    if (/what time|preferred time|available times/i.test(reply)) {
      // First attempt with preferred time
      reply = await send(preferredTime);
    }
    function extractFirstAvailable(r) {
      const matches = [...r.matchAll(/(\d{1,2}:\d{2})\s?(AM|PM)?/gi)].map(
        (m) => m[0]
      );
      if (!matches.length) return null;
      for (const raw of matches) {
        // Skip the originally requested preferredTime if it appears verbatim without AM/PM
        if (raw.toLowerCase().startsWith(preferredTime)) continue;
        return raw;
      }
      return matches[0];
    }
    function to24h(raw) {
      let normalized = raw.toUpperCase();
      const ampm = /(AM|PM)$/.test(normalized) ? normalized.slice(-2) : "";
      let hhmm = normalized.replace(/\s?(AM|PM)$/, "");
      const [h, min] = hhmm.split(":");
      let hNum = parseInt(h, 10);
      if (ampm === "PM" && hNum < 12) hNum += 12;
      if (ampm === "AM" && hNum === 12) hNum = 0;
      return hNum.toString().padStart(2, "0") + ":" + min;
    }
    let safety = 0;
    while (!/appointment is confirmed/i.test(reply) && safety < 5) {
      if (
        /isn'?t available|not available/i.test(reply) ||
        (/available times/i.test(reply) &&
          /how about|available times/i.test(reply))
      ) {
        const alt = extractFirstAvailable(reply);
        if (alt) {
          const sendTime = /AM|PM/i.test(alt) ? to24h(alt) : alt; // normalize if needed
          reply = await send(sendTime);
          safety++;
          continue;
        }
      }
      if (
        /what time|preferred time|available times/i.test(reply) &&
        !/appointment is confirmed/i.test(reply)
      ) {
        // Provide a fallback different slot (e.g. 11:30) if not already tried
        const fallback = "11:30";
        if (!/11:30/.test(reply)) {
          reply = await send(fallback);
          safety++;
          continue;
        }
      }
      break;
    }
    if (!/appointment is confirmed/i.test(reply)) {
      reply = await send("Please confirm that booking");
    }

    const apts = await Appointment.find({}).populate("customer_id");
    const mine = apts.filter(
      (a) => a.customer_id && a.customer_id.whatsapp_number === phone
    );
    if (mine.length) {
      console.log("✅ Appointment(s) created:");
      for (const a of mine) {
        console.log(
          ` • ${
            a.service_name
          } ${a.getFormattedDate()} ${a.getFormattedTime()} [${
            a.status
          }] code=${a.confirmation_code}`
        );
      }
    } else {
      console.log("⚠️ No appointment created. Transcript above for debugging.");
    }
  } catch (e) {
    console.error("❌ Adaptive simulation failed:", e.message || e);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
    } catch (_) {}
  }
})();
