#!/usr/bin/node

const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, require: true },
  phoneNumber: String,
  university: String,
  faculty: String,
  major: String,
  qrSent: {
    type: Boolean,
    default: false,
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true,
  },
  scannedActivities: [{
    _id: false,
    activityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity' },
    scannedAt: { type: Date, default: Date.now }
  }],
}, { timestamps: true });

module.exports = mongoose.model('Participant', participantSchema);
