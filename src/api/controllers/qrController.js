#!/usr/bin/node

const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const { generateQRCode } = require('../../utils/qrUtils');
const { sendEmailEvent } = require('../../services/emailClient');
const Event = require('../../models/Event');
const Activity = require('../../models/Activity');
const Participant  = require('../../models/Participant');

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
}

const sendQRToParticipants = async (req, res) => {
  const { eventId } = req.params;
  const mailBody = req.body?.emailBody || undefined;

  try {
    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const event = await Event.findById(eventId)

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const participants = await Participant.find({ eventId });
    if (!participants || participants.length === 0) {
      return res.status(404).json({ error: 'No participants found for this event' });
    }

    let successCount = 0;
    let skippedCount = 0;
    let failCount = 0;
    const errors = [];

    for (const participant of participants) {
      try {
        const qrCodePath = path.join(__dirname, `../../../uploads/${participant._id}.png`);
        
        if (participant.qrSent) {
          skippedCount++;
          continue;
        }

        if (!fs.existsSync(qrCodePath)) {
          const qrData = `${participant._id}`;
          await generateQRCode(qrData, qrCodePath);
          console.log(`QR code generated for ${participant.name}: ${qrCodePath}`);
        }

        const emailText = (mailBody || (`Hello ${participant.name},\n\nAttached is your QR code for the event: ${event.name}. Please bring it with you to scan for check-in.`)) + `\n\nBest regards,\nIEEE Menoufia Student Branch`;

        const contentBase64 = fs.readFileSync(qrCodePath).toString('base64');
        await sendEmailEvent({
          to: participant.email,
          subject: 'Your Event QR Code',
          text: emailText,
          attachments: [
            {
              filename: `${participant._id}.png`,
              mimeType: 'image/png',
              contentBase64
            }
          ]
        })
        .then(() => {
          participant.qrSent = true;
        })
        .catch((err) => {
          participant.qrSent = false;
          throw new Error(`Failed to enqueue/send email: ${err.message}`);
        });
        await participant.save();
        fs.unlinkSync(qrCodePath);
        successCount++;
      } catch (err) {
        failCount++;
        errors.push({ email: participant.email, error: err.message });
      }
    }

    res.status(200).json({
      message: 'QR code emails processed.',
      total: participants.length,
      sent: successCount,
      skipped: skippedCount,
      failed: failCount,
      errors,
    });

  } catch (error) {
    console.error('Error sending QR codes to participants:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


module.exports = {
  sendQRToParticipants,
  registerActivity
};
