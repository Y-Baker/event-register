const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const eventRoutes = require('../../src/api/routes/eventRoutes');
const Event = require('../../src/models/Event');
const Activity = require('../../src/models/Activity');
const Participant = require('../../src/models/Participant');

function createServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function getBaseUrl(server) {
  const addr = server.address();
  return `http://127.0.0.1:${addr.port}`;
}

function createRoleApp(role) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.auth = { role, authReady: true };
    next();
  });
  app.use('/api/v1/events', eventRoutes);
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}

function stubAttendanceModels({ event, activities, participants }) {
  const originals = {
    eventFindById: Event.findById,
    activityFind: Activity.find,
    participantFind: Participant.find,
  };

  Event.findById = async () => event;
  Activity.find = async () => activities;
  Participant.find = async () => participants;

  return () => {
    Event.findById = originals.eventFindById;
    Activity.find = originals.activityFind;
    Participant.find = originals.participantFind;
  };
}

test('attendance report: organizer can access and receive expected JSON shape', async () => {
  const eventId = '507f1f77bcf86cd799439011';
  const restore = stubAttendanceModels({
    event: { _id: eventId, name: 'Dev Day' },
    activities: [
      { _id: '507f191e810c19729de860aa', name: 'Check In', type: 'Check-In' },
      { _id: '507f191e810c19729de860ab', name: 'Workshop', type: 'Workshop' },
    ],
    participants: [
      {
        _id: '507f191e810c19729de860ea',
        name: 'Alice',
        email: 'alice@example.com',
        scannedActivities: [
          { activityId: '507f191e810c19729de860aa', scannedAt: '2026-02-12T10:00:00.000Z' },
          { activityId: '507f191e810c19729de860ab', scannedAt: '2026-02-12T11:00:00.000Z' },
        ],
      },
      {
        _id: '507f191e810c19729de860eb',
        name: 'Bob',
        email: 'bob@example.com',
        scannedActivities: [],
      },
    ],
  });

  const app = createRoleApp('organizer');
  const server = await createServer(app);

  try {
    const response = await fetch(`${getBaseUrl(server)}/api/v1/events/${eventId}/attendance/report`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.event.id, eventId);
    assert.equal(payload.summary.participantsTotal, 2);
    assert.equal(payload.summary.participantsScannedAny, 1);
    assert.equal(payload.summary.scanRecordsTotal, 2);
    assert.equal(payload.summary.attendanceRatePercent, 50);
    assert.equal(Array.isArray(payload.activities), true);
    assert.equal(Array.isArray(payload.participants), true);
    assert.equal(payload.participants.length, 2);
  } finally {
    restore();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('attendance report: scanner forbidden (403)', async () => {
  const eventId = '507f1f77bcf86cd799439011';
  const app = createRoleApp('scanner');
  const server = await createServer(app);

  try {
    const response = await fetch(`${getBaseUrl(server)}/api/v1/events/${eventId}/attendance/report`);
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.error, 'Forbidden');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('attendance report: invalid eventId returns 400', async () => {
  const app = createRoleApp('organizer');
  const server = await createServer(app);

  try {
    const response = await fetch(`${getBaseUrl(server)}/api/v1/events/not-an-objectid/attendance/report`);
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error, 'Invalid eventId format');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('attendance report: unknown eventId returns 404', async () => {
  const eventId = '507f1f77bcf86cd799439011';
  const restore = stubAttendanceModels({
    event: null,
    activities: [],
    participants: [],
  });

  const app = createRoleApp('organizer');
  const server = await createServer(app);

  try {
    const response = await fetch(`${getBaseUrl(server)}/api/v1/events/${eventId}/attendance/report`);
    const payload = await response.json();
    assert.equal(response.status, 404);
    assert.equal(payload.error, 'Event not found');
  } finally {
    restore();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('attendance export: organizer gets CSV with fixed header and response headers', async () => {
  const eventId = '507f1f77bcf86cd799439011';
  const restore = stubAttendanceModels({
    event: { _id: eventId, name: 'Dev Day' },
    activities: [
      { _id: '507f191e810c19729de860aa', name: 'Check In', type: 'Check-In' },
    ],
    participants: [
      {
        _id: '507f191e810c19729de860ea',
        name: 'Alice',
        email: 'alice@example.com',
        scannedActivities: [
          { activityId: '507f191e810c19729de860aa', scannedAt: '2026-02-12T10:00:00.000Z' },
        ],
      },
    ],
  });

  const app = createRoleApp('organizer');
  const server = await createServer(app);

  try {
    const response = await fetch(`${getBaseUrl(server)}/api/v1/events/${eventId}/attendance/export`);
    const csv = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/csv/);
    assert.match(response.headers.get('content-disposition') || '', new RegExp(`attendance-${eventId}-`));

    const [header] = csv.trimEnd().split('\n');
    assert.equal(header, 'participantId,name,email,scannedCount,lastScannedAt,activityNames');
  } finally {
    restore();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('attendance export: scanner forbidden (403)', async () => {
  const eventId = '507f1f77bcf86cd799439011';
  const app = createRoleApp('scanner');
  const server = await createServer(app);

  try {
    const response = await fetch(`${getBaseUrl(server)}/api/v1/events/${eventId}/attendance/export`);
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.error, 'Forbidden');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('attendance export: CSV sanitizes formula-like values', async () => {
  const eventId = '507f1f77bcf86cd799439011';
  const restore = stubAttendanceModels({
    event: { _id: eventId, name: 'Secure Event' },
    activities: [
      { _id: '507f191e810c19729de860aa', name: '@Danger', type: 'Workshop' },
    ],
    participants: [
      {
        _id: '507f191e810c19729de860ea',
        name: '=Alice',
        email: '+alice@example.com',
        scannedActivities: [
          { activityId: '507f191e810c19729de860aa', scannedAt: '2026-02-12T10:00:00.000Z' },
        ],
      },
    ],
  });

  const app = createRoleApp('admin');
  const server = await createServer(app);

  try {
    const response = await fetch(`${getBaseUrl(server)}/api/v1/events/${eventId}/attendance/export`);
    const csv = await response.text();

    assert.equal(response.status, 200);
    assert.match(csv, /'=Alice/);
    assert.match(csv, /'\+alice@example\.com/);
    assert.match(csv, /'@Danger/);
  } finally {
    restore();
    await new Promise((resolve) => server.close(resolve));
  }
});
