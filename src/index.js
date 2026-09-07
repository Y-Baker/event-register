#!/usr/bin/node

const dotenv = require("dotenv");
const config = require('./config');
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const eventRoutes = require('./api/routes/eventRoutes');
const baseRoutes = require('./api/routes/baseRoutes');
const adminRoutes = require('./api/routes/adminRoutes');
const { authMiddleware, assertAuthConfig } = require('./middlewares/auth');
const { openConnection, bootstrapDefaultRoleKeys } = require("./services/keydbService");
dotenv.config();

try {
  assertAuthConfig();
} catch (err) {
  console.error(`❌ Auth configuration error: ${err.message}`);
  process.exit(1);
}

const app = express();

// Connect to MongoDB
const Port = config.port;
const MONGO_URI = config.mongo.uri;
if (!MONGO_URI || typeof MONGO_URI !== 'string') {
  console.error('❌ MongoDB connection skipped: MONGO_URI is missing or invalid.');
} else {
  mongoose
    .connect(MONGO_URI)
    .then(() => {
      console.log("✅ MongoDB connected");
    })
    .catch((err) => {
      console.error("❌ MongoDB connection error:", err);
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      }
    });
}

// Connect to Redis (handle async errors and missing config)
const hasRedisConfig = process.env.REDIS_URL || (config.redis && config.redis.host);
if (!hasRedisConfig) {
  console.warn('⚠️ Redis config missing; skipping Redis connection.');
} else {
  openConnection()
    .then(() => bootstrapDefaultRoleKeys())
    .catch((err) => {
      console.error('❌ Redis initialization skipped due to error:', err.message);
    });
}

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(cors());
app.use(authMiddleware);

// Routes
app.use('/api/events', eventRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1', baseRoutes);
app.use('/api/v1/admin', adminRoutes);

// Central error handling
app.use((err, req, res, next) => {
  console.error(err.stack);

  res.status(err.status || 500).json({
    error: config.env === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

// JSON 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start the server
const server = app.listen(Port, '0.0.0.0', () => {
  console.log(`Server is running on port ${Port}`);
});

// Graceful shutdown
const handleShutdown = async (signal) => {
  console.log(`Received ${signal}, shutting down Event Register gracefully...`);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

module.exports = app;
