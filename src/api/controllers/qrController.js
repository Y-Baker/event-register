#!/usr/bin/node

const mongoose = require('mongoose');
const { generateQRCodeBuffer } = require('../../utils/qrUtils');
const { sendEmailEvent } = require('../../services/emailClient');
const Event = require('../../models/Event');
const Activity = require('../../models/Activity');
const Participant = require('../../models/Participant');

function parseTicketPayload(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return null;
  const trimmed = rawInput.trim();

  // Try parsing as JSON
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      return parsed.ticketId || parsed.id || parsed._id || null;
    } catch {
      // Fallback
    }
  }

  // Treat as direct ID
  return trimmed;
}

const registerActivity = async (req, res) => {
  try {
    const { eventId } = req.params;
    const body = req.body || {};
    const rawTicket = typeof body.ticketId === 'string' ? body.ticketId : (body.rawPayload || '');
    const activityQrId = typeof body.activityQrId === 'string' ? body.activityQrId.trim() : '';

    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const ticketId = parseTicketPayload(rawTicket);
    if (!ticketId || !activityQrId) {
      return res.status(400).json({ error: 'ticketId and activityQrId are required' });
    }

    if (!mongoose.isValidObjectId(ticketId)) {
      return res.status(400).json({ error: 'Invalid ticketId format' });
    }

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const activity = await Activity.findOne({ eventId, qrId: activityQrId, isActive: { $ne: false } });
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    if (activity.eventId && activity.eventId.toString() !== eventId) {
      return res.status(403).json({ error: 'Activity does not belong to this event' });
    }

    // Check if activity is locked
    if (activity.isLocked) {
      return res.status(400).json({
        error: `Activity "${activity.name}" is locked and closed for scanning.`,
        isLocked: true,
      });
    }

    const participant = await Participant.findById(ticketId);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    if (participant.eventId.toString() !== eventId) {
      return res.status(403).json({ error: 'Participant does not belong to this event' });
    }

    // Atomic update or in-memory fallback
    const pointsToAward = activity.points || 0;
    const updateResult = await Participant.updateOne(
      {
        _id: participant._id,
        eventId,
        'scannedActivities.activityId': { $ne: activity._id },
      },
      {
        $push: {
          scannedActivities: {
            activityId: activity._id,
            scannedAt: new Date(),
            pointsEarned: pointsToAward,
          },
        },
        $inc: { pointsAwarded: pointsToAward },
        $set: { status: 'checked_in' },
      }
    );

    if (updateResult && updateResult.modifiedCount === 0) {
      return res.status(409).json({ error: 'Activity already scanned', alreadyScanned: true });
    }

    if (Array.isArray(participant.scannedActivities)) {
      const already = participant.scannedActivities.some(
        (s) => String(s.activityId) === String(activity._id)
      );
      if (already && (!updateResult || updateResult.modifiedCount === undefined)) {
        return res.status(409).json({ error: 'Activity already scanned', alreadyScanned: true });
      }
    }

    return res.status(200).json({
      message: 'Activity scanned successfully',
      participant: {
        id: String(participant._id),
        name: participant.name,
        email: participant.email,
        university: participant.university,
        faculty: participant.faculty,
        scannedAt: new Date().toISOString(),
        pointsAwarded: (participant.pointsAwarded || 0) + pointsToAward,
        pointsEarned: pointsToAward,
      },
      activity: {
        id: String(activity._id),
        name: activity.name,
        type: activity.type,
        points: activity.points,
      },
    });
  } catch (error) {
    console.error('Error in staff registerActivity:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

const selfCheckIn = async (req, res) => {
  try {
    const { qrId } = req.params;
    const { email } = req.body || {};

    if (!qrId) {
      return res.status(400).json({ error: 'qrId is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Please provide your registered email address.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const activity = await Activity.findOne({ qrId, isActive: { $ne: false } }).populate('eventId');
    if (!activity) {
      return res.status(404).json({ error: 'Invalid QR code or activity not found.' });
    }

    if (activity.isLocked) {
      return res.status(400).json({
        error: `Activity "${activity.name}" is locked and closed for check-in.`,
        isLocked: true,
      });
    }

    if (activity.checkInMode !== 'self_service') {
      return res.status(400).json({
        error: 'This activity is configured for staff scanning only. Please present your ticket to the organizer desk.',
      });
    }

    const event = activity.eventId;
    if (!event) {
      return res.status(404).json({ error: 'Associated event not found.' });
    }

    const participant = await Participant.findOne({
      eventId: event._id,
      email: normalizedEmail,
    });

    if (!participant) {
      return res.status(404).json({
        error: `No registration found for "${normalizedEmail}" in "${event.name}". Please ensure you registered for this event.`,
      });
    }

    const alreadyScanned = (participant.scannedActivities || []).some(
      (s) => String(s.activityId) === String(activity._id)
    );

    if (alreadyScanned) {
      return res.status(409).json({
        error: 'You have already checked in to this activity!',
        alreadyScanned: true,
        participant: {
          name: participant.name,
          email: participant.email,
        },
        activityName: activity.name,
        eventName: event.name,
      });
    }

    const pointsToAward = activity.points || 0;
    participant.scannedActivities.push({
      activityId: activity._id,
      scannedAt: new Date(),
      pointsEarned: pointsToAward,
    });
    participant.pointsAwarded = (participant.pointsAwarded || 0) + pointsToAward;
    participant.status = 'checked_in';
    await participant.save();

    return res.status(200).json({
      message: `Welcome ${participant.name}! Check-in confirmed for ${activity.name}.`,
      participant: {
        id: String(participant._id),
        name: participant.name,
        email: participant.email,
        pointsAwarded: participant.pointsAwarded,
        pointsEarned: pointsToAward,
      },
      activity: {
        id: String(activity._id),
        name: activity.name,
        points: activity.points,
      },
      eventName: event.name,
    });
  } catch (err) {
    console.error('Error in selfCheckIn:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

const sendQRToParticipants = async (req, res) => {
  const { eventId } = req.params;
  const {
    participantId,
    emailSubject,
    emailBody,
    sendToAllUnsent = true,
  } = req.body || {};

  try {
    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    let participants = [];
    if (participantId) {
      if (!mongoose.isValidObjectId(participantId)) {
        return res.status(400).json({ error: 'Invalid participantId format' });
      }
      const single = await Participant.findOne({ _id: participantId, eventId });
      if (!single) {
        return res.status(404).json({ error: 'Participant not found for this event' });
      }
      participants = [single];
    } else {
      const query = { eventId };
      if (sendToAllUnsent) {
        query.qrSent = { $ne: true };
      }
      participants = await Participant.find(query);
    }

    if (participants.length === 0) {
      return res.status(200).json({
        message: 'No eligible participants found for QR code email dispatch.',
        total: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      });
    }

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    const defaultSubject = `Your Ticket Pass & QR Code for ${event.name}`;
    const defaultBody = `Hello {{name}},\n\nYour registration for {{eventName}} has been confirmed!\n\nEvent Date: {{eventDate}}\nVenue: {{venue}}\n\nYour digital ticket ID is {{ticketId}}. Please present the attached QR code at the check-in desk.\n\nBest regards,\nIEEE Menoufia Student Branch`;

    const subjectTemplate = emailSubject || defaultSubject;
    const bodyTemplate = emailBody || defaultBody;

    const formattedDate = event.startDate
      ? new Date(event.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : (event.date ? new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBA');

    for (const participant of participants) {
      try {
        const ticketPayload = JSON.stringify({
          ticketId: String(participant._id),
          eventId: String(event._id),
          name: participant.name,
          email: participant.email,
        });

        const qrBuffer = await generateQRCodeBuffer(ticketPayload);
        const contentBase64 = qrBuffer.toString('base64');

        const personalizedSubject = subjectTemplate
          .replace(/{{name}}/g, participant.name || 'Attendee')
          .replace(/{{eventName}}/g, event.name)
          .replace(/{{eventDate}}/g, formattedDate)
          .replace(/{{venue}}/g, event.venue || event.location || 'IEEE MSB Campus')
          .replace(/{{ticketId}}/g, String(participant._id));

        const personalizedBody = bodyTemplate
          .replace(/{{name}}/g, participant.name || 'Attendee')
          .replace(/{{eventName}}/g, event.name)
          .replace(/{{eventDate}}/g, formattedDate)
          .replace(/{{venue}}/g, event.venue || event.location || 'IEEE MSB Campus')
          .replace(/{{ticketId}}/g, String(participant._id));

        await sendEmailEvent({
          to: participant.email,
          subject: personalizedSubject,
          text: personalizedBody,
          attachments: [
            {
              filename: `ticket-${participant._id}.png`,
              mimeType: 'image/png',
              contentBase64,
            },
          ],
        });

        participant.qrSent = true;
        participant.qrSentAt = new Date();
        participant.status = participant.status === 'registered' ? 'ticket_sent' : participant.status;
        await participant.save();

        successCount++;
      } catch (err) {
        failCount++;
        errors.push({ email: participant.email, error: err.message });
      }
    }

    return res.status(200).json({
      message: `QR code emails processed. Sent: ${successCount}, Failed: ${failCount}.`,
      total: participants.length,
      sent: successCount,
      failed: failCount,
      errors,
    });
  } catch (error) {
    console.error('Error sending QR codes to participants:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = {
  sendQRToParticipants,
  registerActivity,
  selfCheckIn,
};
