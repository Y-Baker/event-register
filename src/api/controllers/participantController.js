#!/usr/bin/node

const fs = require('fs');
const mongoose = require('mongoose');
const csv = require('../../utils/csvUtils');
const { validateParticipantObject } = require('../validators/participantValidator');
const Participant = require('../../models/Participant');
const Event = require('../../models/Event');
const Activity = require('../../models/Activity');

function checkAudienceEligibility(event, authClaims) {
  const audience = event.allowedAudience || 'public';
  if (audience === 'public') {
    return { allowed: true };
  }

  const role = authClaims?.role || 'anonymous';
  const isAnonymous = role === 'anonymous' || !role;

  if (isAnonymous) {
    return {
      allowed: false,
      reason: `This event is restricted to ${audience === 'members_only' ? 'Active Members' : audience === 'leads_only' ? 'Committee Leads' : 'Authenticated Portal Users'}. Please log in first.`,
    };
  }

  if (audience === 'authenticated') {
    return { allowed: true };
  }

  if (['admin', 'officer'].includes(role)) {
    return { allowed: true };
  }

  if (audience === 'leads_only') {
    if (role === 'lead') return { allowed: true };
    return { allowed: false, reason: 'This event is restricted to Committee Leads and Officers only.' };
  }

  if (audience === 'members_only') {
    if (['member', 'lead', 'editor', 'publisher'].includes(role)) return { allowed: true };
    return { allowed: false, reason: 'This event is restricted to Active IEEE MSB Members.' };
  }

  if (audience === 'specific_committees') {
    const allowed = event.allowedCommitteeIds || [];
    const userScopeId = authClaims?.scopeId;
    if (userScopeId && allowed.includes(userScopeId)) return { allowed: true };
    return { allowed: false, reason: 'This event is restricted to specific committee members.' };
  }

  return { allowed: true };
}

const addParticipant = async (req, res) => {
  try {
    const { eventId } = req.params;
    const body = req.body || {};
    const { name, email, phoneNumber, university, faculty, major, customResponses } = body;

    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // 1. Check if registration is open
    if (event.isRegistrationOpen === false) {
      return res.status(400).json({ error: 'Registration for this event is currently closed.' });
    }

    // 2. Check audience eligibility
    const eligibility = checkAudienceEligibility(event, req.auth);
    if (!eligibility.allowed) {
      return res.status(403).json({ error: eligibility.reason });
    }

    // 3. Check capacity
    if (event.capacity && event.capacity > 0) {
      const currentCount = await Participant.countDocuments({ eventId });
      if (currentCount >= event.capacity) {
        return res.status(400).json({ error: `Event has reached its maximum capacity of ${event.capacity} attendees.` });
      }
    }

    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalizedEmail) {
      return res.status(400).json({ error: 'Email address is required.' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }

    // 4. Validate custom fields
    const customFields = event.customFields || [];
    const formattedResponses = typeof customResponses === 'object' && customResponses !== null ? { ...customResponses } : {};

    for (const field of customFields) {
      if (field.required) {
        const val = formattedResponses[field.id];
        if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
          return res.status(400).json({ error: `"${field.label}" is required.` });
        }
      }
    }

    // 5. Check duplicate email in this event
    const exists = await Participant.findOne({ email: normalizedEmail, eventId });
    if (exists) {
      return res.status(409).json({ error: 'This email is already registered for this event.' });
    }

    const participant = new Participant({
      eventId,
      name: name.trim(),
      email: normalizedEmail,
      phoneNumber: phoneNumber ? String(phoneNumber).trim() : null,
      university: university ? university.trim() : null,
      faculty: faculty ? faculty.trim() : null,
      major: major ? major.trim() : null,
      customResponses: formattedResponses,
      status: 'registered',
      registeredByUserId: req.auth?.role && req.auth.role !== 'anonymous' ? (req.auth.scopeId || null) : null,
    });

    await participant.save();

    return res.status(201).json({
      message: 'Participant registered successfully',
      participant,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'This email is already registered for this event.' });
    }
    console.error('Error in addParticipant:', err);
    return res.status(500).json({ error: 'Failed to register participant', details: err.message });
  }
};

const checkInParticipantManual = async (req, res) => {
  const { eventId, participantId } = req.params;
  const { activityId } = req.body || {};

  try {
    if (!mongoose.isValidObjectId(eventId) || !mongoose.isValidObjectId(participantId)) {
      return res.status(400).json({ error: 'Invalid eventId or participantId format' });
    }

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const participant = await Participant.findOne({ _id: participantId, eventId });
    if (!participant) return res.status(404).json({ error: 'Participant not found for this event' });

    // Target activity: if specified use it, otherwise find default or first check-in activity
    let targetActivity = null;
    if (activityId && mongoose.isValidObjectId(activityId)) {
      targetActivity = await Activity.findOne({ _id: activityId, eventId, isActive: { $ne: false } });
    } else {
      targetActivity = await Activity.findOne({ eventId, type: 'check-in', isActive: { $ne: false } }) ||
                       await Activity.findOne({ eventId, isActive: { $ne: false } });
    }

    if (!targetActivity) {
      return res.status(404).json({ error: 'No active check-in activity found for this event' });
    }

    if (targetActivity.isLocked) {
      return res.status(400).json({ error: `Activity "${targetActivity.name}" is locked / closed.` });
    }

    const alreadyScanned = (participant.scannedActivities || []).some(
      (s) => String(s.activityId) === String(targetActivity._id)
    );

    if (alreadyScanned) {
      return res.status(409).json({
        error: `Participant is already checked in for ${targetActivity.name}`,
        alreadyScanned: true,
        participant,
      });
    }

    const pointsToAward = targetActivity.points || 0;
    participant.scannedActivities.push({
      activityId: targetActivity._id,
      scannedAt: new Date(),
      pointsEarned: pointsToAward,
    });
    participant.pointsAwarded = (participant.pointsAwarded || 0) + pointsToAward;
    participant.status = 'checked_in';
    await participant.save();

    return res.status(200).json({
      message: `Manual check-in confirmed for ${participant.name} (${targetActivity.name})!`,
      participant,
      activity: targetActivity,
    });
  } catch (err) {
    console.error('Error in manual check-in:', err);
    return res.status(500).json({ error: 'Failed to check in participant', details: err.message });
  }
};

const getEventParticipants = async (req, res) => {
  const { eventId } = req.params;
  const { search, status } = req.query;

  try {
    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const query = { eventId: event._id };

    if (search && search.trim()) {
      const q = search.trim();
      const regex = new RegExp(q, 'i');
      query.$or = [
        { name: regex },
        { email: regex },
        { phoneNumber: regex },
        { university: regex },
        { faculty: regex },
      ];
    }

    if (status && status !== 'all') {
      if (status === 'checked_in') {
        query['scannedActivities.0'] = { $exists: true };
      } else if (status === 'not_checked_in') {
        query['scannedActivities.0'] = { $exists: false };
      } else if (status === 'ticket_sent') {
        query.qrSent = true;
      }
    }

    const participants = await Participant.find(query).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ participants: participants || [] });
  } catch (err) {
    console.error('Error fetching participants:', err);
    return res.status(500).json({ error: 'Failed to fetch participants' });
  }
};

const getParticipantById = async (req, res) => {
  const { eventId, participantId } = req.params;
  try {
    if (!mongoose.isValidObjectId(participantId)) {
      return res.status(400).json({ error: 'Invalid participantId format' });
    }

    const participant = await Participant.findOne({ _id: participantId, eventId });
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found in this event' });
    }
    return res.status(200).json({ participant });
  } catch (err) {
    console.error('Error fetching participant:', err);
    return res.status(500).json({ error: 'Failed to fetch participant' });
  }
};

const deleteParticipant = async (req, res) => {
  const { eventId, participantId } = req.params;
  try {
    if (!mongoose.isValidObjectId(participantId)) {
      return res.status(400).json({ error: 'Invalid participantId format' });
    }

    const participant = await Participant.findOneAndDelete({ _id: participantId, eventId });
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    return res.status(200).json({ message: 'Participant removed successfully' });
  } catch (err) {
    console.error('Error deleting participant:', err);
    return res.status(500).json({ error: 'Failed to delete participant' });
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

    for (const item of rawRows) {
      const normalized = {
        name: (item.name || item.Name || '').trim(),
        email: (item.email || item.Email || '').trim().toLowerCase(),
        phoneNumber: (item.phoneNumber || item.Number || item.Phone || '').toString().trim(),
        university: (item.university || item.University || '').trim(),
        faculty: (item.faculty || item.Faculty || '').trim(),
        major: (item.major || item.Major || '').trim(),
      };

      try {
        if (!normalized.name || !normalized.email) {
          errors.push({ participant: normalized, error: 'Name and Email are required' });
          continue;
        }

        const exists = await Participant.findOne({ email: normalized.email, eventId });
        if (exists) {
          errors.push({ participant: normalized, error: 'Email already registered for this event' });
          continue;
        }

        await Participant.create({ ...normalized, eventId, status: 'registered' });
        successful++;
      } catch (err) {
        errors.push({ participant: normalized, error: err.message });
      }
    }

    return res.json({
      message: 'Upload complete',
      total: rawRows.length,
      successful,
      errors: errors.length,
      errorDetails: errors,
    });
  } catch (err) {
    console.error('CSV Parsing Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to process CSV file' });
  }
};

module.exports = {
  addParticipant,
  checkInParticipantManual,
  getEventParticipants,
  getParticipantById,
  deleteParticipant,
  uploadCSV,
};
