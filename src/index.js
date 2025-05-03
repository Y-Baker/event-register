#!/usr/bin/node

const dotenv = require("dotenv");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const fs = require('fs');
const path = require('path');

const eventRoutes = require('./api/routes/eventRoutes');
const baseRoutes = require('./api/routes/baseRoutes');
dotenv.config();


const app = express();

// Connect to MongoDB
const Port = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });

// Middleware
app.use(express.json());
app.use(cors());

// Routes
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1', baseRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});
app.use((req, res) => {
  const imagePath = path.join(__dirname, '../', '404.jpg');

  fs.readFile(imagePath, (err, data) => {
    if (err) {
      res.status(500).send('Error loading 404 image.');
    } else {
      res.writeHead(404, {
        'Content-Type': 'image/jpeg',
        'Content-Length': data.length
      });
      res.end(data);
    }
  });
});

// Start the server
app.listen(Port, () => {
  console.log(`Server is running on port ${Port}`);
});

module.exports = app;