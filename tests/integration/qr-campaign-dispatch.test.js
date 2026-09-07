const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');

process.env.AUTH_CLAIMS_HMAC_SECRET = process.env.AUTH_CLAIMS_HMAC_SECRET || 'integration-claims-secret';

const eventRoutes = require('../../src/api/routes/eventRoutes');
const { authMiddleware } = require('../../src/middlewares/auth');
const { buildSignedClaimsHeaders } = require('../../src/auth/claimsContract');
const Event = require('../../src/models/Event');
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

const CLAIMS_SECRET = process.env.AUTH_CLAIMS_HMAC_SECRET;

function buildHeaders(claims) {
  return buildSignedClaimsHeaders({
    ...claims,
    exp: Math.floor(Date.now() / 1000) + 300,
  }, CLAIMS_SECRET);
}

function makeObjectIdFactory() {
  let counter = 300;
  return () => new mongoose.Types.ObjectId((counter++).toString(16).padStart(24, '0'));
}

function installInMemoryModelStubs() {
  const nextObjectId = makeObjectIdFactory();
  const db = {
    events: new Map(),
    participants: new Map(),
  };

  const originals = {
    eventSave: Event.prototype.save,
    eventFindById: Event.findById,
    participantSave: Participant.prototype.save,
    participantFind: Participant.find,
    participantFindOne: Participant.findOne,
    participantUpdateMany: Participant.updateMany,
  };

  Event.prototype.save = async function saveStub() {
    if (!this._id) this._id = nextObjectId();
    db.events.set(String(this._id), this);
    return this;
  };

  Event.findById = (id) => ({
    exec: async () => db.events.get(String(id)) || null,
    then: (resolve, reject) => Event.findById(id).exec().then(resolve, reject),
  });

  Participant.prototype.save = async function saveStub() {
    if (!this._id) this._id = nextObjectId();
    db.participants.set(String(this._id), this);
    return this;
  };

  Participant.find = (query = {}) => {
    const list = Array.from(db.participants.values()).filter((p) => {
      if (query.eventId && String(p.eventId) !== String(query.eventId)) return false;
      if (query.qrSent && query.qrSent.$ne === true && p.qrSent === true) return false;
      if (query._id && query._id.$in) {
        const inIds = query._id.$in.map(String);
        if (!inIds.includes(String(p._id))) return false;
      }
      return true;
    });

    return {
      exec: async () => list,
      then: (resolve, reject) => Promise.resolve(list).then(resolve, reject),
    };
  };

  Participant.findOne = (query = {}) => {
    const match = Array.from(db.participants.values()).find((p) => {
      if (query._id && String(p._id) !== String(query._id)) return false;
      if (query.eventId && String(p.eventId) !== String(query.eventId)) return false;
      return true;
    }) || null;

    return {
      exec: async () => match,
      then: (resolve, reject) => Promise.resolve(match).then(resolve, reject),
    };
  };

  Participant.updateMany = async (filter = {}, update = {}) => {
    let matchedCount = 0;
    let modifiedCount = 0;
    const filterIds = filter._id?.$in ? filter._id.$in.map(String) : null;

    for (const [id, p] of db.participants.entries()) {
      if (filter.eventId && String(p.eventId) !== String(filter.eventId)) continue;
      if (filterIds && !filterIds.includes(id)) continue;

      matchedCount++;
      if (update.$set) {
        Object.assign(p, update.$set);
        modifiedCount++;
      }
    }

    return { matchedCount, modifiedCount };
  };

  function restore() {
    Event.prototype.save = originals.eventSave;
    Event.findById = originals.eventFindById;
    Participant.prototype.save = originals.participantSave;
    Participant.find = originals.participantFind;
    Participant.findOne = originals.participantFindOne;
    Participant.updateMany = originals.participantUpdateMany;
  }

  return { db, restore, nextObjectId };
}

test('QR Campaign Dispatch: prepare-campaign & dispatch-callback flow', async (t) => {
  const { db, restore, nextObjectId } = installInMemoryModelStubs();
  t.after(restore);

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/v1/events', eventRoutes);

  const server = await createServer(app);
  t.after(() => server.close());
  const baseUrl = getBaseUrl(server);

  const eventId = nextObjectId();
  const event = new Event({
    _id: eventId,
    name: 'Hackathon 2026',
    venue: 'Main Campus Hall',
    startDate: new Date(),
  });
  await event.save();

  const p1Id = nextObjectId();
  const p1 = new Participant({
    _id: p1Id,
    eventId,
    name: 'Yousef Mansour',
    email: 'yousef@ieeemsb.org',
    status: 'registered',
    qrSent: false,
  });
  await p1.save();

  const p2Id = nextObjectId();
  const p2 = new Participant({
    _id: p2Id,
    eventId,
    name: 'Sarah Connor',
    email: 'sarah@ieeemsb.org',
    status: 'registered',
    qrSent: false,
  });
  await p2.save();

  // Test 1: Prepare campaign with scheduled date
  const organizerClaims = {
    userId: 'org-1',
    role: 'organizer',
    scopeType: 'event',
    scopeId: String(eventId),
  };

  const prepRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/qr/prepare-campaign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildHeaders(organizerClaims),
    },
    body: JSON.stringify({
      sendToAllUnsent: true,
      scheduledFor: '2026-10-15T09:00:00.000Z',
    }),
  });

  assert.equal(prepRes.status, 200);
  const prepBody = await prepRes.json();
  assert.equal(prepBody.total, 2);
  assert.equal(prepBody.isScheduled, true);
  assert.equal(prepBody.recipients.length, 2);

  const r1 = prepBody.recipients.find((r) => r.email === 'yousef@ieeemsb.org');
  assert.ok(r1, 'recipient 1 should exist');
  assert.equal(r1.attachments.length, 1);
  assert.equal(r1.attachments[0].filename, `ticket-${p1Id}.png`);
  assert.ok(r1.attachments[0].contentBase64.length > 50, 'base64 QR buffer should be populated');

  // Verify participant status transitioned to ticket_scheduled
  assert.equal(p1.status, 'ticket_scheduled');
  assert.equal(p2.status, 'ticket_scheduled');

  // Test 2: Dispatch callback updates participants to ticket_sent
  const callbackRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/qr/dispatch-callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      participantIds: [String(p1Id), String(p2Id)],
    }),
  });

  assert.equal(callbackRes.status, 200);
  const cbBody = await callbackRes.json();
  assert.equal(cbBody.success, true);
  assert.equal(cbBody.matchedCount, 2);

  // Verify updated status in database
  assert.equal(p1.status, 'ticket_sent');
  assert.equal(p1.qrSent, true);
  assert.ok(p1.qrSentAt instanceof Date);
  assert.equal(p2.status, 'ticket_sent');
  assert.equal(p2.qrSent, true);
});
