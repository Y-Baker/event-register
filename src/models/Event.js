#!/usr/bin/node

const mongoose = require('mongoose');

const customFieldSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  type: {
    type: String,
    enum: ['text', 'select', 'textarea', 'number', 'checkbox', 'national_id'],
    default: 'text',
  },
  options: [{ type: String }],
  required: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
  order: { type: Number, default: 0 },
}, { _id: false });

const eventSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
  },
  startDate: {
    type: Date,
    default: null,
  },
  endDate: {
    type: Date,
    default: null,
  },
  location: {
    type: String,
    required: true,
    trim: true,
  },
  venue: {
    type: String,
    trim: true,
    default: null,
  },
  category: {
    type: String,
    trim: true,
    default: 'General',
  },
  bannerUrl: {
    type: String,
    trim: true,
    default: null,
  },
  coverImageUrl: {
    type: String,
    trim: true,
    default: null,
  },
  capacity: {
    type: Number,
    default: -1, // -1 represents unlimited capacity
  },
  isRegistrationOpen: {
    type: Boolean,
    default: true,
  },
  allowedAudience: {
    type: String,
    enum: ['public', 'authenticated', 'members_only', 'leads_only', 'specific_committees'],
    default: 'public',
  },
  allowedCommitteeIds: [{
    type: String,
  }],
  customFields: [customFieldSchema],
  scannerUserIds: [{
    type: String,
  }],
  status: {
    type: String,
    enum: ['active', 'past', 'archived', 'draft', 'published', 'completed', 'cancelled'],
    default: 'active',
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Participant',
  }],
}, { timestamps: true });

eventSchema.index({ status: 1, isRegistrationOpen: 1, startDate: 1 });

module.exports = mongoose.model('Event', eventSchema);