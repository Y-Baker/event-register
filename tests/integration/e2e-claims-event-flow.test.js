const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');

process.env.AUTH_CLAIMS_HMAC_SECRET = process.env.AUTH_CLAIMS_HMAC_SECRET || 'integration-claims-secret';

const eventRoutes = require('../../src/api/routes/eventRoutes');
const { authMiddleware } = require('../../src/middlewares/auth');
const { buildSignedClaimsHeaders } = require('../../src/auth/claimsContract');
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

function makeObjectIdFactory() {
  let counter = 1;
  return () => new mongoose.Types.ObjectId((counter++).toString(16).padStart(24, '0'));
}

function installInMemoryModelStubs() {
  const nextObjectId = makeObjectIdFactory();
  const db = {
    events: new Map(),
    activities: new Map(),
    participants: new Map(),
  };

  const originals = {
    eventSave: Event.prototype.save,
    eventFindById: Event.findById,
    eventFind: Event.find,
    eventFindByIdAndDelete: Event.findByIdAndDelete,
    activitySave: Activity.prototype.save,
    activityFindById: Activity.findById,
    activityFindOne: Activity.findOne,
    activityFind: Activity.find,
    participantSave: Participant.prototype.save,
    participantFindById: Participant.findById,
    participantFindOne: Participant.findOne,
    participantFind: Participant.find,
    participantUpdateOne: Participant.updateOne,
    participantCreate: Participant.create,
  };

  Event.prototype.save = async function saveEventStub() {
    const id = this._id ? String(this._id) : String(nextObjectId());
    this._id = id;
    const record = {
      _id: id,
      name: this.name,
      description: this.description,
      date: this.date || new Date().toISOString(),
      location: this.location,
      participants: [],
    };
    db.events.set(id, record);
    return this;
  };

  Event.findById = async (id) => {
    const record = db.events.get(String(id));
    return record ? { ...record } : null;
  };

  Event.find = async () => Array.from(db.events.values()).map((item) => ({ ...item }));

  Event.findByIdAndDelete = async (id) => {
    const key = String(id);
    const record = db.events.get(key);
    if (!record) return null;
    db.events.delete(key);
    return { ...record };
  };

  Activity.prototype.save = async function saveActivityStub() {
    const id = this._id ? String(this._id) : String(nextObjectId());
    this._id = id;
    const record = {
      _id: id,
      eventId: String(this.eventId),
      name: this.name,
      type: this.type,
      qrId: this.qrId,
    };
    db.activities.set(id, record);
    return this;
  };

  Activity.findById = async (id) => {
    const record = db.activities.get(String(id));
    return record ? { ...record } : null;
  };

  Activity.findOne = async (filter) => {
    const qrId = filter?.qrId;
    for (const record of db.activities.values()) {
      if (record.qrId === qrId) {
        return { ...record };
      }
    }
    return null;
  };

  Activity.find = async (filter = {}) => {
    const eventId = filter.eventId ? String(filter.eventId) : null;
    return Array.from(db.activities.values())
      .filter((record) => !eventId || record.eventId === eventId)
      .map((record) => ({ ...record }));
  };

  Participant.prototype.save = async function saveParticipantStub() {
    const id = this._id ? String(this._id) : String(nextObjectId());
    this._id = id;
    const record = {
      _id: id,
      eventId: String(this.eventId),
      name: this.name,
      email: this.email,
      phoneNumber: this.phoneNumber,
      university: this.university,
      faculty: this.faculty,
      major: this.major,
      qrSent: Boolean(this.qrSent),
      scannedActivities: Array.isArray(this.scannedActivities)
        ? this.scannedActivities.map((scan) => ({
            activityId: String(scan.activityId),
            scannedAt: scan.scannedAt ? new Date(scan.scannedAt).toISOString() : new Date().toISOString(),
          }))
        : [],
    };
    db.participants.set(id, record);
    return this;
  };

  Participant.findById = async (id) => {
    const record = db.participants.get(String(id));
    return record ? { ...record, scannedActivities: [...record.scannedActivities] } : null;
  };

  Participant.findOne = async (filter = {}) => {
    const email = filter.email ? String(filter.email).toLowerCase() : null;
    const eventId = filter.eventId ? String(filter.eventId) : null;

    for (const record of db.participants.values()) {
      if (email && record.email !== email) continue;
      if (eventId && record.eventId !== eventId) continue;
      return { ...record, scannedActivities: [...record.scannedActivities] };
    }
    return null;
  };

  Participant.find = async (filter = {}) => {
    const eventId = filter.eventId ? String(filter.eventId) : null;
    return Array.from(db.participants.values())
      .filter((record) => !eventId || record.eventId === eventId)
      .map((record) => ({ ...record, scannedActivities: [...record.scannedActivities] }));
  };

  Participant.updateOne = async (filter = {}, update = {}) => {
    const participant = db.participants.get(String(filter._id));
    if (!participant) return { matchedCount: 0, modifiedCount: 0 };
    if (String(filter.eventId) !== participant.eventId) return { matchedCount: 0, modifiedCount: 0 };

    const blockedActivityId = filter['scannedActivities.activityId']?.$ne
      ? String(filter['scannedActivities.activityId'].$ne)
      : null;
    if (blockedActivityId) {
      const alreadyScanned = participant.scannedActivities.some(
        (scan) => String(scan.activityId) === blockedActivityId
      );
      if (alreadyScanned) return { matchedCount: 0, modifiedCount: 0 };
    }

    const pushed = update.$push?.scannedActivities;
    if (!pushed || !pushed.activityId) return { matchedCount: 1, modifiedCount: 0 };

    participant.scannedActivities.push({
      activityId: String(pushed.activityId),
      scannedAt: pushed.scannedAt ? new Date(pushed.scannedAt).toISOString() : new Date().toISOString(),
    });
    db.participants.set(participant._id, participant);
    return { matchedCount: 1, modifiedCount: 1 };
  };

  Participant.create = async (payload) => {
    const doc = new Participant(payload);
    return doc.save();
  };

  return () => {
    Event.prototype.save = originals.eventSave;
    Event.findById = originals.eventFindById;
    Event.find = originals.eventFind;
    Event.findByIdAndDelete = originals.eventFindByIdAndDelete;
    Activity.prototype.save = originals.activitySave;
    Activity.findById = originals.activityFindById;
    Activity.findOne = originals.activityFindOne;
    Activity.find = originals.activityFind;
    Participant.prototype.save = originals.participantSave;
    Participant.findById = originals.participantFindById;
    Participant.findOne = originals.participantFindOne;
    Participant.find = originals.participantFind;
    Participant.updateOne = originals.participantUpdateOne;
    Participant.create = originals.participantCreate;
  };
}

test('e2e claims flow: organizer and scanner can complete event lifecycle', async () => {
  const restoreModels = installInMemoryModelStubs();

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/v1/events', eventRoutes);
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  const server = await createServer(app);
  const baseUrl = getBaseUrl(server);
  const secret = process.env.AUTH_CLAIMS_HMAC_SECRET;

  try {
    const organizerGlobalHeaders = buildSignedClaimsHeaders(
      { role: 'organizer', scope_type: 'global' },
      secret
    );

    const createEventRes = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...organizerGlobalHeaders,
      },
      body: JSON.stringify({
        name: 'Claims Flow Event',
        description: 'End-to-end auth flow',
        location: 'Main Hall',
      }),
    });
    assert.equal(createEventRes.status, 201);
    const createEventPayload = await createEventRes.json();
    const eventId = String(createEventPayload.event._id);
    assert.ok(eventId);

    const organizerEventHeaders = buildSignedClaimsHeaders(
      { role: 'organizer', scope_type: 'event', scope_id: eventId },
      secret
    );

    const createActivityRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/activities`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...organizerEventHeaders,
      },
      body: JSON.stringify({
        name: 'Attendance',
        type: 'Check-In',
      }),
    });
    assert.equal(createActivityRes.status, 201);
    const createActivityPayload = await createActivityRes.json();
    const activityQrId = createActivityPayload.activity.qrId;
    assert.ok(activityQrId);

    const createParticipantRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/participants`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...organizerEventHeaders,
      },
      body: JSON.stringify({
        name: 'Scanner User',
        email: 'scanner.user@example.com',
      }),
    });
    assert.equal(createParticipantRes.status, 201);
    const createParticipantPayload = await createParticipantRes.json();
    const participantId = String(createParticipantPayload.participant._id);
    assert.ok(participantId);

    const scannerEventHeaders = buildSignedClaimsHeaders(
      { role: 'scanner', scope_type: 'event', scope_id: eventId },
      secret
    );

    const scanRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/qr/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...scannerEventHeaders,
      },
      body: JSON.stringify({
        ticketId: participantId,
        activityQrId,
      }),
    });
    assert.equal(scanRes.status, 200);
    const scanPayload = await scanRes.json();
    assert.equal(scanPayload.message, 'Activity scanned successfully');

    const reportRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/attendance/report`, {
      method: 'GET',
      headers: organizerEventHeaders,
    });
    assert.equal(reportRes.status, 200);
    const reportPayload = await reportRes.json();
    assert.equal(reportPayload.summary.participantsTotal, 1);
    assert.equal(reportPayload.summary.participantsScannedAny, 1);
    assert.equal(reportPayload.summary.scanRecordsTotal, 1);
    assert.equal(reportPayload.activities[0].scanCount, 1);

    const exportRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/attendance/export`, {
      method: 'GET',
      headers: organizerEventHeaders,
    });
    assert.equal(exportRes.status, 200);
    const exportCsv = await exportRes.text();
    assert.match(exportCsv, /participantId,name,email,scannedCount,lastScannedAt,activityNames/);
    assert.match(exportCsv, /scanner\.user@example\.com/);
  } finally {
    restoreModels();
    await new Promise((resolve) => server.close(resolve));
  }
});
