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
    trim: true,
  },
  type: {
    type: String,
    required: true,
    trim: true,
    default: 'check-in',
  },
  points: {
    type: Number,
    default: 10,
    min: 0,
  },
  isLocked: {
    type: Boolean,
    default: false,
  },
  checkInMode: {
    type: String,
    enum: ['staff_scanner', 'self_service'],
    default: 'staff_scanner',
  },
  qrId: {
    type: String,
    required: true,
    unique: true,
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  isRestricted: {
    type: Boolean,
    default: false,
  },
  allowedParticipantIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Participant',
  }],
  allowedEmails: [{
    type: String,
    trim: true,
    lowercase: true,
  }],
  order: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

activitySchema.index({ eventId: 1, qrId: 1 });

module.exports = mongoose.model('Activity', activitySchema);
