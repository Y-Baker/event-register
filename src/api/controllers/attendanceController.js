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
      name: activity.name || '',
      type: activity.type || '',
      scanCount: 0,
    });
  }

  const participantRows = [];
  let participantsScannedAny = 0;
  let scanRecordsTotal = 0;

  for (const participant of participants) {
    const scans = Array.isArray(participant.scannedActivities) ? participant.scannedActivities : [];
    if (scans.length > 0) {
      participantsScannedAny += 1;
    }
    scanRecordsTotal += scans.length;

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
      name: participant.name || '',
      email: participant.email || '',
      scannedCount: scans.length,
      lastScannedAt,
      activityNames: Array.from(activityNames),
    });
  }

  participantRows.sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.participantId.localeCompare(b.participantId);
  });

  const activitiesPayload = Array.from(activityMap.entries())
    .map(([activityId, value]) => ({
      activityId,
      name: value.name,
      type: value.type,
      scanCount: value.scanCount,
    }))
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName;
      return a.activityId.localeCompare(b.activityId);
    });

  const participantsTotal = participants.length;
  const attendanceRatePercent = participantsTotal === 0
    ? 0
    : roundToTwo((participantsScannedAny / participantsTotal) * 100);

  return {
    event: {
      id: String(event._id),
      name: event.name || '',
    },
    summary: {
      participantsTotal,
      participantsScannedAny,
      scanRecordsTotal,
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

  const [activities, participants] = await Promise.all([
    Activity.find({ eventId }),
    Participant.find({ eventId }),
  ]);

  return buildAttendancePayload(event, activities, participants);
}

function buildAuditLog(action, req, details) {
  return {
    action,
    timestamp: new Date().toISOString(),
    role: req.auth?.role || 'unknown',
    eventId: req.params?.eventId || null,
    ...details,
  };
}

const getAttendanceReport = async (req, res) => {
  try {
    const { eventId } = req.params;
    const data = await getAttendanceData(eventId);
    console.info(JSON.stringify(buildAuditLog('event.attendance.report.requested', req, {
      status: 'success',
      participantsTotal: data.summary.participantsTotal,
      scanRecordsTotal: data.summary.scanRecordsTotal,
    })));
    return res.status(200).json(data);
  } catch (error) {
    const status = error.status || 500;
    const message = status === 500 ? 'Internal server error' : error.message;
    console.info(JSON.stringify(buildAuditLog('event.attendance.report.requested', req, {
      status: 'failed',
      statusCode: status,
      error: message,
    })));
    return res.status(status).json({ error: message });
  }
};

const exportAttendanceCsv = async (req, res) => {
  try {
    const { eventId } = req.params;
    const data = await getAttendanceData(eventId);
    const csv = serializeAttendanceCsv(data.participants);
    const date = new Date().toISOString().slice(0, 10);

    console.info(JSON.stringify(buildAuditLog('event.attendance.export.requested', req, {
      status: 'success',
      participantsTotal: data.summary.participantsTotal,
      exportedRows: data.participants.length,
    })));

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="attendance-${eventId}-${date}.csv"`);
    return res.status(200).send(csv);
  } catch (error) {
    const status = error.status || 500;
    const message = status === 500 ? 'Internal server error' : error.message;
    console.info(JSON.stringify(buildAuditLog('event.attendance.export.requested', req, {
      status: 'failed',
      statusCode: status,
      error: message,
    })));
    return res.status(status).json({ error: message });
  }
};

module.exports = {
  getAttendanceReport,
  exportAttendanceCsv,
};
