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

    // Enforce scanner authorization if specific scanners are assigned
    const scanningUserId = req.auth?.userId || req.auth?.user_id || body.scannerUserId || null;
    const isGlobalAdminOrOfficer = req.auth?.role === 'admin' || req.auth?.role === 'officer';
    const isEventOrganizer = req.auth?.role === 'organizer' && (!event.createdBy || String(event.createdBy) === String(scanningUserId));
    const hasAssignedScanners = Array.isArray(event.scannerUserIds) && event.scannerUserIds.length > 0;

    if (hasAssignedScanners && !isGlobalAdminOrOfficer) {
      const isAssigned = event.scannerUserIds.some((id) => String(id) === String(scanningUserId));
      if (!isAssigned && !isEventOrganizer) {
        return res.status(403).json({
          error: 'Access Restricted: You are not an authorized scanner for this event.',
          isUnauthorizedScanner: true,
        });
      }
    }

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

    // Check if activity is restricted by whitelist
    const { allowOverride = false } = body;
    if (activity.isRestricted) {
      const partIdStr = String(participant._id);
      const partEmail = (participant.email || '').trim().toLowerCase();
      const inAllowedIds = Array.isArray(activity.allowedParticipantIds) &&
        activity.allowedParticipantIds.some((id) => String(id) === partIdStr);
      const inAllowedEmails = Array.isArray(activity.allowedEmails) &&
        activity.allowedEmails.some((e) => e.trim().toLowerCase() === partEmail);
      const isWhitelisted = inAllowedIds || inAllowedEmails;

      if (!isWhitelisted) {
        if (allowOverride) {
          // Strictly enforce that only Organizers, Officers, or Admins can override
          const hasOrganizerAccess = isGlobalAdminOrOfficer || isEventOrganizer;
          if (!hasOrganizerAccess) {
            return res.status(403).json({
              error: 'Scanner staff cannot override whitelist restrictions. Contact an event organizer or officer.',
              isRestricted: true,
              unauthorizedOverride: true,
            });
          }
        } else {
          return res.status(403).json({
            error: `Attendee "${participant.name}" is not on the whitelist for "${activity.name}".`,
            isRestricted: true,
            participant: {
              id: String(participant._id),
              name: participant.name,
              email: participant.email,
            },
            activity: {
              id: String(activity._id),
              name: activity.name,
            },
          });
        }
      }
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

    if (activity.isRestricted) {
      const partIdStr = String(participant._id);
      const partEmail = normalizedEmail;
      const inAllowedIds = Array.isArray(activity.allowedParticipantIds) &&
        activity.allowedParticipantIds.some((id) => String(id) === partIdStr);
      const inAllowedEmails = Array.isArray(activity.allowedEmails) &&
        activity.allowedEmails.some((e) => e.trim().toLowerCase() === partEmail);

      if (!inAllowedIds && !inAllowedEmails) {
        return res.status(403).json({
          error: `Access Denied: You are not on the authorized whitelist for "${activity.name}". Please contact the organizers.`,
          isRestricted: true,
        });
      }
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
    subject,
    bodyTemplate: bodyParam,
    body: directBody,
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

    const subjectTemplate = emailSubject || subject || defaultSubject;
    const bodyTemplate = emailBody || bodyParam || directBody || defaultBody;

    const formattedDate = event.startDate
      ? new Date(event.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'TBA';

    const venueText = event.venue || event.location || 'IEEE MSB Campus';
    const venueMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueText)}`;
    const startDateObj = event.startDate ? new Date(event.startDate) : new Date();
    const endDateObj = event.endDate ? new Date(event.endDate) : new Date(startDateObj.getTime() + 3 * 3600 * 1000);
    const calDates = `${startDateObj.toISOString().replace(/[-:]/g, '').split('.')[0]}Z/${endDateObj.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
    const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.name || 'IEEE Event')}&dates=${calDates}&details=${encodeURIComponent('Official IEEE Menoufia Student Branch Event')}&location=${encodeURIComponent(venueText)}`;

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
          .replace(/{{email}}/g, participant.email || '')
          .replace(/{{eventName}}/g, event.name)
          .replace(/{{eventDate}}/g, formattedDate)
          .replace(/{{venue}}/g, venueText)
          .replace(/{{venueMapUrl}}/g, venueMapUrl)
          .replace(/{{calendarUrl}}/g, calendarUrl)
          .replace(/{{ticketId}}/g, String(participant._id));

        const personalizedBody = bodyTemplate
          .replace(/{{name}}/g, participant.name || 'Attendee')
          .replace(/{{email}}/g, participant.email || '')
          .replace(/{{eventName}}/g, event.name)
          .replace(/{{eventDate}}/g, formattedDate)
          .replace(/{{venue}}/g, venueText)
          .replace(/{{venueMapUrl}}/g, venueMapUrl)
          .replace(/{{calendarUrl}}/g, calendarUrl)
          .replace(/{{ticketId}}/g, String(participant._id));

        const isHtml = /<[a-z][\s\S]*>/i.test(personalizedBody);

        await sendEmailEvent({
          to: participant.email,
          subject: personalizedSubject,
          text: personalizedBody,
          ...(isHtml ? { html: personalizedBody } : {}),
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

const prepareEventQRCampaign = async (req, res) => {
  const { eventId } = req.params;
  const {
    participantId,
    participantIds,
    sendToAllUnsent = true,
    scheduledFor = null,
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
    } else if (Array.isArray(participantIds) && participantIds.length > 0) {
      participants = await Participant.find({
        _id: { $in: participantIds.filter((id) => mongoose.isValidObjectId(id)) },
        eventId,
      });
    } else {
      const query = { eventId };
      if (sendToAllUnsent) {
        query.qrSent = { $ne: true };
      }
      participants = await Participant.find(query);
    }

    if (participants.length === 0) {
      return res.status(200).json({
        message: 'No eligible participants found for QR ticket dispatch.',
        total: 0,
        recipients: [],
      });
    }

    const formattedDate = event.startDate
      ? new Date(event.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'TBA';

    const venueText = event.venue || event.location || 'IEEE MSB Campus';
    const venueMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueText)}`;
    const startDateObj = event.startDate ? new Date(event.startDate) : new Date();
    const endDateObj = event.endDate ? new Date(event.endDate) : new Date(startDateObj.getTime() + 3 * 3600 * 1000);
    const calDates = `${startDateObj.toISOString().replace(/[-:]/g, '').split('.')[0]}Z/${endDateObj.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
    const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.name || 'IEEE Event')}&dates=${calDates}&details=${encodeURIComponent('Official IEEE Menoufia Student Branch Event')}&location=${encodeURIComponent(venueText)}`;

    const recipients = [];
    const isScheduled = Boolean(scheduledFor);

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

        recipients.push({
          email: participant.email,
          name: participant.name || 'Attendee',
          participantId: String(participant._id),
          ticketId: String(participant._id),
          customFields: {
            name: participant.name || 'Attendee',
            email: participant.email,
            ticketId: String(participant._id),
            eventName: event.name,
            eventDate: formattedDate,
            venue: venueText,
            venueMapUrl,
            calendarUrl,
            participantId: String(participant._id),
          },
          attachments: [
            {
              filename: `ticket-${participant._id}.png`,
              mimeType: 'image/png',
              contentBase64,
            },
          ],
        });

        if (isScheduled && participant.status === 'registered') {
          participant.status = 'ticket_scheduled';
          await participant.save();
        }
      } catch (err) {
        console.error(`Error preparing QR for participant ${participant._id}:`, err);
      }
    }

    return res.status(200).json({
      message: `Prepared ${recipients.length} ticket recipients for campaign dispatch.`,
      total: recipients.length,
      recipients,
      isScheduled,
    });
  } catch (error) {
    console.error('Error preparing QR campaign:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

const dispatchCallback = async (req, res) => {
  const { eventId } = req.params;
  const { participantIds = [] } = req.body || {};

  try {
    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ error: 'participantIds must be a non-empty array' });
    }

    const validIds = participantIds.filter((id) => mongoose.isValidObjectId(id));
    const updateResult = await Participant.updateMany(
      {
        _id: { $in: validIds },
        eventId,
      },
      {
        $set: {
          qrSent: true,
          qrSentAt: new Date(),
          status: 'ticket_sent',
        },
      }
    );

    return res.status(200).json({
      success: true,
      matchedCount: updateResult.matchedCount,
      modifiedCount: updateResult.modifiedCount,
    });
  } catch (error) {
    console.error('Error handling dispatch callback:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = {
  sendQRToParticipants,
  prepareEventQRCampaign,
  dispatchCallback,
  registerActivity,
  selfCheckIn,
};
