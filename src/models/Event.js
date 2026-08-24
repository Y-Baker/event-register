#!/usr/bin/node

const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  location: {
    type: String,
    required: true,
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
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Participant',
  }],
}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);