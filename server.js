const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const dotenv = require("dotenv");
const path = require("path");

// Load environment variables
dotenv.config();

// Validate environment variables (throws error if invalid)
const { validateEnvironment } = require("./config/validateEnv");
try {
  validateEnvironment();
} catch (error) {
  console.error("❌ Failed to start server:", error.message);
  process.exit(1);
}

// Import routes
const webhookRoutes = require("./routes/webhook");
const adminRoutes = require("./routes/admin");
const businessRoutes = require("./routes/business");
const { processIncomingMessage } = require("./services/aiService");
const { sendWhatsAppMessage } = require("./services/whatsappService");
const { addOutbound, getOutbound, clearOutbound } = (() => {
  try {
    return require("./services/mockMessageStore");
  } catch (_) {
    return {
      addOutbound: () => {},
      getOutbound: () => [],
      clearOutbound: () => {},
    };
  }
})();

// Import database (Mongoose connection is handled in config/database.js)
require("./config/database");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());

// CORS configuration - restrict to trusted origins in production
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [])
    : true, // Allow all in development
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Parse JSON bodies (WhatsApp sends JSON)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/webhook", webhookRoutes);
app.use("/admin", adminRoutes);
app.use("/business", businessRoutes);

// Twilio WhatsApp webhook (if provider=twilio)
app.post(
  "/webhook/twilio",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      if ((process.env.WHATSAPP_PROVIDER || "").toLowerCase() !== "twilio") {
        return res.status(400).send("Twilio provider not active");
      }
      const from = req.body.From || "";
      const body = req.body.Body || "";
      if (!from || !body) {
        return res.status(200).send("IGNORED");
      }
      const cleanFrom = from.replace(/^whatsapp:/, "");
      const response = await processIncomingMessage({
        messageText: body,
        customerPhone: cleanFrom,
        customerName: null,
        messageId: req.body.MessageSid || `tw_${Date.now()}`,
      });
      if (response) {
        try {
          await sendWhatsAppMessage(cleanFrom, response);
        } catch (_) {}
      }
      res.status(200).send("OK");
    } catch (e) {
      console.error("Twilio webhook error", e.message);
      res.status(500).send("ERROR");
    }
  }
);

// Health check endpoint with dependency validation
app.get("/health", async (req, res) => {
  const health = {
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Spark WhatsApp AI",
    checks: {
      database: "unknown",
      redis: "unknown",
    },
  };

  try {
    // Check MongoDB connection
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState === 1) {
      health.checks.database = "connected";
      // Quick query test
      try {
        await mongoose.connection.db.admin().ping();
        health.checks.database = "healthy";
      } catch (err) {
        health.checks.database = "disconnected";
        health.status = "degraded";
      }
    } else {
      health.checks.database = "disconnected";
      health.status = "unhealthy";
    }
  } catch (err) {
    health.checks.database = "error";
    health.status = "unhealthy";
  }

  // Check Redis connection (optional)
  try {
    const { getRedis } = require("./services/redisClient");
    const redis = await getRedis();
    if (redis && redis.isOpen) {
      await redis.ping();
      health.checks.redis = "healthy";
    } else {
      health.checks.redis = "disabled";
    }
  } catch (err) {
    health.checks.redis = "error";
    // Redis is optional, so don't fail health check
  }

  const statusCode = health.status === "OK" ? 200 : health.status === "degraded" ? 200 : 503;
  res.status(statusCode).json(health);
});

// Mock / debug routes (only when provider=mock) - protected by ADMIN_TOKEN
app.post("/debug/inject", async (req, res) => {
  try {
    if ((process.env.WHATSAPP_PROVIDER || "").toLowerCase() !== "mock") {
      return res.status(400).json({ error: "Mock provider not active" });
    }
    console.log("Debug inject request:", req.body, process.env.ADMIN_TOKEN);
    console.log("req.headers['x-admin-token']", req.headers["x-admin-token"]);
    if (
      !process.env.ADMIN_TOKEN ||
      req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN
    ) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { from, message, name } = req.body || {};
    if (!from || !message)
      return res.status(400).json({ error: "from and message required" });
    const aiReply = await processIncomingMessage({
      messageText: message,
      customerPhone: from,
      customerName: name || null,
      messageId: `mock_${Date.now()}`,
    });
    if (aiReply) {
      // Instead of sending externally, record as outbound mock message
      addOutbound({
        provider: "mock",
        to: from,
        body: aiReply,
        type: "ai-reply",
      });
    }
    res.json({ injected: true, aiReply });
  } catch (e) {
    console.error("debug/inject error", e);
    res.status(500).json({ error: "internal error" });
  }
});

app.get("/debug/messages", (req, res) => {
  try {
    if ((process.env.WHATSAPP_PROVIDER || "").toLowerCase() !== "mock") {
      return res.status(400).json({ error: "Mock provider not active" });
    }
    if (
      !process.env.ADMIN_TOKEN ||
      req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN
    ) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const limit = parseInt(req.query.limit || "100", 10);
    res.json({ messages: getOutbound(limit) });
  } catch (e) {
    res.status(500).json({ error: "internal error" });
  }
});

app.post("/debug/messages/clear", (req, res) => {
  try {
    if ((process.env.WHATSAPP_PROVIDER || "").toLowerCase() !== "mock") {
      return res.status(400).json({ error: "Mock provider not active" });
    }
    if (
      !process.env.ADMIN_TOKEN ||
      req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN
    ) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    clearOutbound();
    res.json({ cleared: true });
  } catch (e) {
    res.status(500).json({ error: "internal error" });
  }
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Spark WhatsApp AI - Appointment Scheduling Agent",
    version: "1.0.0",
    endpoints: {
      webhook: "/webhook",
      admin: "/admin",
      business: "/business",
      health: "/health",
    },
  });
});

// Provide same info for POST / to avoid 404 when accidentally POSTing root
app.post("/", (req, res) => {
  res.json({
    message: "Spark WhatsApp AI - Appointment Scheduling Agent",
    version: "1.0.0",
    note: "This endpoint is read-only; POST body ignored.",
    endpoints: {
      webhook: "/webhook",
      admin: "/admin",
      business: "/business",
      health: "/health",
      debugInject: "/debug/inject (POST, mock mode)",
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Log error with context (but sanitize sensitive data in production)
  const errorDetails = process.env.NODE_ENV === "development" 
    ? { message: err.message, stack: err.stack }
    : { message: err.message };
  
  console.error("Error:", {
    message: err.message,
    path: req.path,
    method: req.method,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });

  // Don't expose stack traces or sensitive information in production
  res.status(err.status || 500).json({
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "An error occurred processing your request",
    ...(process.env.NODE_ENV === "development" && { details: errorDetails }),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: "The requested endpoint does not exist",
  });
});

// Initialize database and start server
async function startServer() {
  try {
    if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === "test") {
      console.log("🧪 Test mode: server listen skipped");
      return;
    }
    app.listen(PORT, () => {
      console.log(`🚀 Spark WhatsApp AI server running on port ${PORT}`);
      console.log(`📱 Webhook URL: http://localhost:${PORT}/webhook`);
      console.log(`🔗 Ngrok URL: ${process.env.NGROK_URL}/webhook`);
      console.log(`⚡ Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
