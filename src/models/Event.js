#!/usr/bin/node

const mongoose = require('mongoose');

const customFieldSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  type: {
    type: String,
    enum: ['text', 'select', 'textarea', 'number', 'checkbox'],
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
  date: {
    type: Date,
    default: Date.now,
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
    default: null,
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
  points: {
    type: Number,
    default: 25,
  },
  customFields: [customFieldSchema],
  scannerUserIds: [{
    type: String,
  }],
  status: {
    type: String,
    enum: ['draft', 'published', 'completed', 'cancelled'],
    default: 'published',
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Participant',
  }],
}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);