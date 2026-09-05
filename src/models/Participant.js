#!/usr/bin/node

const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phoneNumber: { type: String, trim: true, default: null },
  university: { type: String, trim: true, default: null },
  faculty: { type: String, trim: true, default: null },
  major: { type: String, trim: true, default: null },
  customResponses: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  status: {
    type: String,
    enum: ['registered', 'ticket_sent', 'checked_in', 'cancelled'],
    default: 'registered',
  },
  registeredByUserId: {
    type: String,
    default: null,
  },
  pointsAwarded: {
    type: Number,
    default: 0,
  },
  qrSent: {
    type: Boolean,
    default: false,
  },
  qrSentAt: {
    type: Date,
    default: null,
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true,
  },
  scannedActivities: [{
    _id: false,
    activityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity' },
    scannedAt: { type: Date, default: Date.now },
    pointsEarned: { type: Number, default: 0 },
  }],
}, { timestamps: true });

participantSchema.index({ eventId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('Participant', participantSchema);
