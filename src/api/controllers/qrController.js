#!/usr/bin/node

const path = require('path');
const fs = require('fs');

const { generateQRCode } = require('../../utils/qrUtils');
const { sendEmail } = require('../../services/emailService');
const Event = require('../../models/Event');
const Activity = require('../../models/Activity');
const Participant  = require('../../models/Participant');

const registerActivity = async (req, res) => {
  const { ticketId, activityId } = req.query;

  const participant = await Participant.findById(ticketId);
  if (!participant) return res.status(404).send('Participant not found');

  const activity = await Activity.findOne({ qrId: activityId });
  if (!activity) return res.status(404).send('Activity not found');

  if (activity.eventId.toString() !== participant.eventId.toString()) {
    return res.status(400).send('QR code does not belong to this event');
  }

  const alreadyScanned = participant.scannedActivities.find(scan =>
    scan.activityId.toString() === activity._id.toString()
  );

  if (alreadyScanned) {
    return res.status(400).send('Activity already scanned');
  }

  participant.scannedActivities.push({ activityId: activity._id });
  await participant.save();

  return res.status(200).send('Activity scanned successfully');
}

const sendQRToParticipants = async (req, res) => {
  const { eventId } = req.params;
  const mailBody = req.body?.emailBody || undefined;

  try {
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

        const emailText = `Hello ${participant.name},\n\n` +  `Attached is your QR code for the event: ${event.name}. Please bring it with you to scan for check-in.` || mailBody + `\n\nBest regards,\nIEEE Menoufia Student Branch`;

        await sendEmail(
          participant.email,
          'Your Event QR Code',
          emailText,
          [{ filename: `${participant._id}.png`, path: qrCodePath }]
        ).then(() => {
          participant.qrSent = true;
        }).catch((err) => {
          participant.qrSent = false;
          throw new Error(`Failed to send email: ${err.message}`);
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
