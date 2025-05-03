#!/usr/bin/node

const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  type: { // e.g., 'check-in', 'meal', 'workshop'
    type: String,
    required: true,
  },
  qrId: {
    type: String,
    required: true,
    unique: true,
  }
}, { timestamps: true });

module.exports = mongoose.model('Activity', activitySchema);
