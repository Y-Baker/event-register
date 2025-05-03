#!/usr/bin/node

const fs = require('fs');
const csv = require('../../utils/csvUtils');
const { validateParticipantObject } = require('../validators/participantValidator');
const Participant  = require('../../models/Participant');
const Event = require('../../models/Event');

const addParticipant = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { name, email, phoneNumber, university, faculty, major } = req.body;

    const exists = await Participant.findOne({ email, eventId });
    if (exists) {
      return res.status(400).json({ error: 'Email already registered for this event' });
    }

    const participant = new Participant({
      eventId,
      name, email, phoneNumber, university, faculty, major
    });

    await participant.save();

    res.status(201).json({ message: 'Participant added', participant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add participant' });
  }
};

const uploadCSV = async (req, res) => {
  const { eventId } = req.params;
  const filePath = req.file.path;

  try {
    const rawRows = await csv.parseCSV(filePath);
    fs.unlinkSync(filePath);

    const errors = [];
    let successful = 0;
  
    for (const participant of rawRows) {
      try {
        const validationErrors = await validateParticipantObject({participant, eventId});
        if (validationErrors) {
          errors.push({ participant, error: validationErrors });
          continue;
        }

        // Check for duplicates in the event
        const exists = await Participant.findOne({ email: participant.email, eventId });
        if (exists) {
          errors.push({ participant, error: 'Email already registered for this event' });
          continue;
        }

        await Participant.create({ ...participant, eventId });
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
    res.status(500).json({ error: 'Failed to process CSV file' });
  }
}

const getEventParticipants = async (req, res) => {
  const { eventId } = req.params;

  const event = await Event.findById(eventId)

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const participants = await Participant.find({ eventId });
  if (!participants || participants.length === 0) {
    return res.status(404).json({ error: 'No participants found for this event' });
  }

  res.status(200).json({ participants });
}

const getParticipantById = async (req, res) => {
  const { eventId, participantId } = req.params;

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