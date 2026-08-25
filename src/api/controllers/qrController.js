#!/usr/bin/node

const mongoose = require('mongoose');

const { generateQRCodeBuffer } = require('../../utils/qrUtils');
const { sendEmailEvent } = require('../../services/emailClient');
const Event = require('../../models/Event');
const Activity = require('../../models/Activity');
const Participant = require('../../models/Participant');

const registerActivity = async (req, res) => {
  try {
    const { eventId } = req.params;
    const body = req.body || {};
    const ticketId = typeof body.ticketId === 'string' ? body.ticketId.trim() : '';
    const activityQrId = typeof body.activityQrId === 'string' ? body.activityQrId.trim() : '';

    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    if (!ticketId || !activityQrId) {
      return res.status(400).json({ error: 'ticketId and activityQrId are required' });
    }

    if (!mongoose.isValidObjectId(ticketId)) {
      return res.status(400).json({ error: 'Invalid ticketId format' });
    }

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const participant = await Participant.findById(ticketId);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    if (participant.eventId.toString() !== eventId) {
      return res.status(403).json({ error: 'Participant does not belong to this event' });
    }

    const activity = await Activity.findOne({ qrId: activityQrId });
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    if (activity.eventId.toString() !== eventId) {
      return res.status(403).json({ error: 'Activity does not belong to this event' });
    }

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
          },
        },
      }
    );

    if (!updateResult || updateResult.modifiedCount === 0) {
      return res.status(409).json({ error: 'Activity already scanned' });
    }

    return res.status(200).json({ message: 'Activity scanned successfully' });
  } catch (error) {
    const status = error.status || 500;
    const message = status === 500 ? 'Internal server error' : error.message;
    return res.status(status).json({ error: message });
  }
};

const sendQRToParticipants = async (req, res) => {
  const { eventId } = req.params;
  const mailBody = req.body?.emailBody || undefined;

  try {
    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const participants = await Participant.find({ eventId });
    if (!participants || participants.length === 0) {
      return res.status(200).json({
        message: 'No participants found for this event.',
        total: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      });
    }

    let successCount = 0;
    let skippedCount = 0;
    let failCount = 0;
    const errors = [];

    for (const participant of participants) {
      try {
        if (participant.qrSent) {
          skippedCount++;
          continue;
        }

        // Generate QR code directly in memory without disk I/O
        const qrBuffer = await generateQRCodeBuffer(String(participant._id));
        const contentBase64 = qrBuffer.toString('base64');

        const emailText =
          (mailBody ||
            `Hello ${participant.name},\n\nAttached is your QR code for the event: ${event.name}. Please bring it with you to scan for check-in.`) +
          `\n\nBest regards,\nIEEE Menoufia Student Branch`;

        await sendEmailEvent({
          to: participant.email,
          subject: 'Your Event QR Code',
          text: emailText,
          attachments: [
            {
              filename: `${participant._id}.png`,
              mimeType: 'image/png',
              contentBase64,
            },
          ],
        });

        participant.qrSent = true;
        await participant.save();
        successCount++;
      } catch (err) {
        failCount++;
        errors.push({ email: participant.email, error: err.message });
      }
    }

    return res.status(200).json({
      message: 'QR code emails processed.',
      total: participants.length,
      sent: successCount,
      skipped: skippedCount,
      failed: failCount,
      errors,
    });
  } catch (error) {
    console.error('Error sending QR codes to participants:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  sendQRToParticipants,
  registerActivity,
};
