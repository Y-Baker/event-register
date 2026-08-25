#!/usr/bin/node

const fs = require('fs');
const mongoose = require('mongoose');
const csv = require('../../utils/csvUtils');
const { validateParticipantObject } = require('../validators/participantValidator');
const Participant  = require('../../models/Participant');
const Event = require('../../models/Event');

const addParticipant = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { name, email, phoneNumber, university, faculty, major } = req.body;
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : email;

    const exists = await Participant.findOne({ email: normalizedEmail, eventId });
    if (exists) {
      return res.status(409).json({ error: 'Email already registered for this event' });
    }

    const participant = new Participant({
      eventId,
      name, email: normalizedEmail, phoneNumber, university, faculty, major
    });

    await participant.save();

    res.status(201).json({ message: 'Participant added', participant });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'Email already registered for this event' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to add participant' });
  }
};

const uploadCSV = async (req, res) => {
  const { eventId } = req.params;
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Ensure field name is "file" and the file is a CSV.' });
  }
  const filePath = req.file.path;

  try {
    const rawRows = await csv.parseCSV(filePath);
    try { fs.unlinkSync(filePath); } catch {}

    const errors = [];
    let successful = 0;
  
    for (const participant of rawRows) {
      // Normalize incoming CSV keys to expected fields
      const normalized = {
        name: (participant.name || participant.Name || '').trim(),
        email: (participant.email || participant.Email || '').trim().toLowerCase(),
        phoneNumber: (participant.phoneNumber || participant.Number || participant.Phone || '').toString().trim(),
        university: (participant.university || participant.University || '').trim(),
        faculty: (participant.faculty || participant.Faculty || '').trim(),
        major: (participant.major || participant.Major || '').trim()
      };

      try {
        const validationErrors = await validateParticipantObject({participant: normalized, eventId});
        if (validationErrors) {
          errors.push({ participant, error: validationErrors });
          continue;
        }

        // Check for duplicates in the event
        const exists = await Participant.findOne({ email: normalized.email, eventId });
        if (exists) {
          errors.push({ participant, error: 'Email already registered for this event' });
          continue;
        }

        await Participant.create({ ...normalized, eventId });
        successful++;
      } catch (err) {
        errors.push({ participant, error: err.message });
      }
    }

  
    res.json({
      message: 'Upload complete',
      total: rawRows.length,
      successful,
      errors: errors.length,
      errorDetails: errors
    });

  } catch (err) {
    console.error('CSV Parsing Error:', err);
    const message = err && err.message ? err.message : 'Failed to process CSV file';
    res.status(500).json({ error: message });
  }
}

const getEventParticipants = async (req, res) => {
  const { eventId } = req.params;

  if (!mongoose.isValidObjectId(eventId)) {
    return res.status(400).json({ error: 'Invalid eventId format' });
  }

  const event = await Event.findById(eventId);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const participants = await Participant.find({ eventId: event._id });
  return res.status(200).json({ participants: participants || [] });
};

const getParticipantById = async (req, res) => {
  const { eventId, participantId } = req.params;

  if (!mongoose.isValidObjectId(participantId)) {
    return res.status(400).json({ error: 'Invalid participantId format' });
  }

  const event = await Event.findById(eventId);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const participant = await Participant.findById(participantId);
  if (!participant) {
    return res.status(404).json({ error: 'Participant not found' });
  }
  if (!participant.eventId.equals(event._id)) {
    return res.status(404).json({ error: 'Participant not found in this event' });
  }
  res.status(200).json({ participant });
}


module.exports = {
  addParticipant,
  uploadCSV,
  getEventParticipants,
  getParticipantById
};
