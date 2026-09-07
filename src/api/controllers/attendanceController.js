#!/usr/bin/node

const mongoose = require('mongoose');
const Event = require('../../models/Event');
const Activity = require('../../models/Activity');
const Participant = require('../../models/Participant');
const { serializeAttendanceCsv } = require('../../utils/attendanceCsv');

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function roundToTwo(value) {
  return Math.round(value * 100) / 100;
}

function buildAttendancePayload(event, activities, participants) {
  const activityMap = new Map();
  for (const activity of activities) {
    activityMap.set(String(activity._id), {
      activityId: String(activity._id),
      name: activity.name || '',
      type: activity.type || '',
      points: activity.points || 0,
      isLocked: Boolean(activity.isLocked),
      checkInMode: activity.checkInMode || 'staff_scanner',
      scanCount: 0,
    });
  }

  const participantRows = [];
  let participantsScannedAny = 0;
  let scanRecordsTotal = 0;
  let totalPointsDistributed = 0;

  for (const participant of participants) {
    const scans = Array.isArray(participant.scannedActivities) ? participant.scannedActivities : [];
    if (scans.length > 0) {
      participantsScannedAny += 1;
    }
    scanRecordsTotal += scans.length;
    totalPointsDistributed += (participant.pointsAwarded || 0);

    let lastScannedAt = null;
    const activityNames = new Set();

    for (const scan of scans) {
      if (!scan || !scan.activityId) continue;
      const activityId = String(scan.activityId);
      const mapped = activityMap.get(activityId);
      if (mapped) {
        mapped.scanCount += 1;
        activityNames.add(mapped.name);
      }

      const scannedAtIso = toIsoOrNull(scan.scannedAt);
      if (scannedAtIso && (!lastScannedAt || scannedAtIso > lastScannedAt)) {
        lastScannedAt = scannedAtIso;
      }
    }

    participantRows.push({
      participantId: String(participant._id),
      _id: String(participant._id),
      name: participant.name || '',
      email: participant.email || '',
      phoneNumber: participant.phoneNumber || '',
      university: participant.university || '',
      faculty: participant.faculty || '',
      major: participant.major || '',
      status: participant.status || 'registered',
      qrSent: Boolean(participant.qrSent),
      qrSentAt: toIsoOrNull(participant.qrSentAt),
      customResponses: participant.customResponses || {},
      pointsAwarded: participant.pointsAwarded || 0,
      scannedCount: scans.length,
      lastScannedAt,
      activityNames: Array.from(activityNames),
      scannedActivities: scans,
    });
  }

  participantRows.sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.participantId.localeCompare(b.participantId);
  });

  const activitiesPayload = Array.from(activityMap.values()).sort((a, b) => {
    return a.name.localeCompare(b.name);
  });

  const participantsTotal = participants.length;
  const attendanceRatePercent = participantsTotal === 0
    ? 0
    : roundToTwo((participantsScannedAny / participantsTotal) * 100);

  return {
    event: {
      id: String(event._id),
      name: event.name || '',
      capacity: event.capacity,
      customFields: event.customFields || [],
    },
    summary: {
      participantsTotal,
      participantsScannedAny,
      scanRecordsTotal,
      totalPointsDistributed,
      attendanceRatePercent,
    },
    activities: activitiesPayload,
    participants: participantRows,
  };
}

async function getAttendanceData(eventId) {
  if (!mongoose.isValidObjectId(eventId)) {
    const error = new Error('Invalid eventId format');
    error.status = 400;
    throw error;
  }

  const event = await Event.findById(eventId);
  if (!event) {
    const error = new Error('Event not found');
    error.status = 404;
    throw error;
  }

  const actQuery = Activity.find({ eventId });
  const activities = (actQuery && typeof actQuery.then === 'function') ? await actQuery : (actQuery || []);

  const partQuery = Participant.find({ eventId });
  const participants = (partQuery && typeof partQuery.then === 'function') ? await partQuery : (partQuery || []);

  return buildAttendancePayload(event, activities, participants);
}

const getAttendanceReport = async (req, res) => {
  try {
    const { eventId } = req.params;
    const data = await getAttendanceData(eventId);
    return res.status(200).json(data);
  } catch (error) {
    const status = error.status || 500;
    const message = status === 500 ? 'Internal server error' : error.message;
    return res.status(status).json({ error: message });
  }
};

const exportAttendanceCsv = async (req, res) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const actQuery = Activity.find({ eventId });
    const rawActivities = (actQuery && typeof actQuery.then === 'function') ? await actQuery : (actQuery || []);
    const activities = Array.isArray(rawActivities) ? rawActivities : [];

    const partQuery = Participant.find({ eventId });
    const rawParticipants = (partQuery && typeof partQuery.then === 'function') ? await partQuery : (partQuery || []);
    const participants = Array.isArray(rawParticipants) ? rawParticipants : [];

    const csvContent = serializeAttendanceCsv(participants, {
      customFields: event.customFields || [],
      activities,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${eventId}-${Date.now()}.csv"`);
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error('Error exporting attendance CSV:', error);
    return res.status(500).json({ error: 'Failed to export attendance CSV' });
  }
};

const awardActivityPoints = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { participantIds, pointsOverride } = req.body || {};

    if (!mongoose.isValidObjectId(eventId)) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const query = { eventId, 'scannedActivities.0': { $exists: true } };
    if (Array.isArray(participantIds) && participantIds.length > 0) {
      query._id = { $in: participantIds.filter((id) => mongoose.isValidObjectId(id)) };
    }

    const participants = await Participant.find(query);
    const basePoints = pointsOverride !== undefined && pointsOverride !== null ? Number(pointsOverride) : 25;

    let updatedCount = 0;
    let totalPointsAwarded = 0;

    for (const participant of participants) {
      const earned = basePoints;
      participant.pointsAwarded = (participant.pointsAwarded || 0) + earned;
      await participant.save();
      updatedCount++;
      totalPointsAwarded += earned;
    }

    return res.status(200).json({
      message: `Activity points distributed to ${updatedCount} checked-in participants.`,
      updatedCount,
      pointsPerAttendee: basePoints,
      totalPointsAwarded,
    });
  } catch (error) {
    console.error('Error awarding activity points:', error);
    return res.status(500).json({ error: 'Failed to award activity points' });
  }
};

module.exports = {
  getAttendanceReport,
  exportAttendanceCsv,
  awardActivityPoints,
};
