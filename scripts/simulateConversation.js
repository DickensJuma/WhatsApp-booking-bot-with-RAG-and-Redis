#!/usr/bin/env node
// Simulate an end-to-end booking conversation using the internal processIncomingMessage function.
// Requires: MONGODB running, OPENAI_API_KEY, WHATSAPP_PROVIDER=mock (recommended), BUSINESS seeded (run seedLocal first).
require("dotenv").config();

const mongoose = require("mongoose");
const { processIncomingMessage } = require("../services/aiService");
const Business = require("../model/Business");

(async () => {
  const phone = "+15550009999";
  const name = "SimUser";
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

    // Scripted customer inputs (adjust date to tomorrow for realism)
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const isoTomorrow = tomorrow.toISOString().slice(0, 10); // YYYY-MM-DD

    const script = [
      "Hi",
      "I want to book a facial",
      "Tomorrow",
      "10:00",
      "Thanks",
    ];

    console.log("\n💬 Simulation starting...\n");

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

    console.log("✅ Simulation complete");
  } catch (e) {
    console.error("❌ Simulation failed:", e.message || e);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
    } catch (_) {}
  }
})();
