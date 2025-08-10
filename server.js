const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const dotenv = require("dotenv");
const path = require("path");

// Load environment variables
dotenv.config();

// Import routes
const webhookRoutes = require("./routes/webhook");
const adminRoutes = require("./routes/admin");
const businessRoutes = require("./routes/business");

// Import database (Mongoose connection is handled in config/database.js)
require("./config/database");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan("combined"));

// Parse JSON bodies (WhatsApp sends JSON)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/webhook", webhookRoutes);
app.use("/admin", adminRoutes);
app.use("/business", businessRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Spark WhatsApp AI",
  });
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
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
