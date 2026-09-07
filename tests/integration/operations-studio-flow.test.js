const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');

process.env.AUTH_CLAIMS_HMAC_SECRET = process.env.AUTH_CLAIMS_HMAC_SECRET || 'integration-claims-secret';

const eventRoutes = require('../../src/api/routes/eventRoutes');
const baseRoutes = require('../../src/api/routes/baseRoutes');
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

const CLAIMS_SECRET = process.env.AUTH_CLAIMS_HMAC_SECRET;

function buildHeaders(claims) {
  return buildSignedClaimsHeaders({
    ...claims,
    exp: Math.floor(Date.now() / 1000) + 300,
  }, CLAIMS_SECRET);
}

function makeObjectIdFactory() {
  let counter = 100;
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
    eventFindByIdAndUpdate: Event.findByIdAndUpdate,
    eventFind: Event.find,
    eventCountDocuments: Event.countDocuments,
    eventFindByIdAndDelete: Event.findByIdAndDelete,
    activitySave: Activity.prototype.save,
    activityFindById: Activity.findById,
    activityFindByIdAndUpdate: Activity.findByIdAndUpdate,
    activityFindOne: Activity.findOne,
    activityFind: Activity.find,
    participantSave: Participant.prototype.save,
    participantFindById: Participant.findById,
    participantFindOne: Participant.findOne,
    participantFind: Participant.find,
    participantCountDocuments: Participant.countDocuments,
    participantUpdateOne: Participant.updateOne,
    participantCreate: Participant.create,
  };

  Event.prototype.save = async function saveEventStub() {
    const id = this._id ? String(this._id) : String(nextObjectId());
    this._id = id;
    const record = {
      _id: id,
      id,
      name: this.name,
      description: this.description,
      startDate: this.startDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: this.endDate || null,
      location: this.location,
      venue: this.venue,
      category: this.category,
      capacity: this.capacity,
      isRegistrationOpen: this.isRegistrationOpen,
      allowedAudience: this.allowedAudience,
      customFields: this.customFields || [],
      scannerUserIds: this.scannerUserIds || [],
      status: this.status || 'published',
      participants: [],
    };
    db.events.set(id, record);
    return this;
  };

  Event.findById = (id) => {
    const record = db.events.get(String(id));
    const obj = record ? { ...record } : null;
    return {
      lean: async () => obj,
      then: (resolve) => resolve(obj),
    };
  };

  Event.findByIdAndUpdate = async (id, update) => {
    const record = db.events.get(String(id));
    if (!record) return null;
    const set = update.$set || update;
    Object.assign(record, set);
    db.events.set(String(id), record);
    return { ...record };
  };

  Event.find = () => {
    const list = Array.from(db.events.values()).map((item) => ({ ...item }));
    return {
      sort: () => ({
        lean: async () => list,
        then: (resolve) => resolve(list),
      }),
      lean: async () => list,
      then: (resolve) => resolve(list),
    };
  };

  Activity.prototype.save = async function saveActivityStub() {
    const id = this._id ? String(this._id) : String(nextObjectId());
    this._id = id;
    const record = {
      _id: id,
      id,
      eventId: String(this.eventId),
      name: this.name,
      type: this.type,
      points: this.points || 10,
      isLocked: Boolean(this.isLocked),
      checkInMode: this.checkInMode || 'staff_scanner',
      qrId: this.qrId,
      description: this.description || '',
      isActive: true,
      order: this.order || 0,
    };
    db.activities.set(id, record);
    return this;
  };

  Activity.findById = async (id) => {
    const record = db.activities.get(String(id));
    return record ? { ...record } : null;
  };

  Activity.findByIdAndUpdate = async (id, update) => {
    const record = db.activities.get(String(id));
    if (!record) return null;
    const set = update.$set || update;
    Object.assign(record, set);
    db.activities.set(String(id), record);
    return { ...record };
  };

  Activity.findOne = (filter) => {
    let match = null;
    for (const record of db.activities.values()) {
      if (filter?.qrId && record.qrId === filter.qrId) {
        match = { ...record };
        break;
      }
      if (filter?.eventId && filter?.type && record.eventId === String(filter.eventId) && record.type === filter.type) {
        match = { ...record };
        break;
      }
      if (filter?.eventId && record.eventId === String(filter.eventId)) {
        match = { ...record };
        break;
      }
    }
    return {
      populate: async () => {
        if (!match) return null;
        const ev = db.events.get(match.eventId);
        return { ...match, eventId: ev };
      },
      then: (resolve) => resolve(match),
    };
  };

  Activity.find = (filter) => {
    const eventId = filter?.eventId ? String(filter.eventId) : null;
    const list = Array.from(db.activities.values())
      .filter((item) => !eventId || item.eventId === eventId)
      .map((item) => ({ ...item }));
    return {
      sort: () => ({
        lean: async () => list,
        then: (resolve) => resolve(list),
      }),
      lean: async () => list,
      then: (resolve) => resolve(list),
    };
  };

  Activity.aggregate = async () => [];

  Participant.prototype.save = async function saveParticipantStub() {
    const id = this._id ? String(this._id) : String(nextObjectId());
    this._id = id;
    const record = {
      _id: id,
      id,
      eventId: String(this.eventId),
      name: this.name,
      email: this.email,
      phoneNumber: this.phoneNumber,
      university: this.university,
      faculty: this.faculty,
      major: this.major,
      customResponses: this.customResponses || {},
      status: this.status || 'registered',
      pointsAwarded: this.pointsAwarded || 0,
      scannedActivities: this.scannedActivities || [],
    };
    db.participants.set(id, record);
    return this;
  };

  Participant.findById = async (id) => {
    const record = db.participants.get(String(id));
    if (!record) return null;
    return {
      ...record,
      save: async function () {
        db.participants.set(String(record._id), this);
        return this;
      },
    };
  };

  Participant.findOne = async (filter) => {
    for (const record of db.participants.values()) {
      if (filter?.email && record.email.toLowerCase() === filter.email.toLowerCase()) {
        if (!filter.eventId || record.eventId === String(filter.eventId)) {
          return {
            ...record,
            save: async function () {
              db.participants.set(String(record._id), this);
              return this;
            },
          };
        }
      }
      if (filter?._id && String(record._id) === String(filter._id)) {
        return {
          ...record,
          save: async function () {
            db.participants.set(String(record._id), this);
            return this;
          },
        };
      }
    }
    return null;
  };

  Participant.find = (filter) => {
    const eventId = filter?.eventId ? String(filter.eventId) : null;
    const list = Array.from(db.participants.values())
      .filter((item) => !eventId || item.eventId === eventId)
      .map((item) => ({
        ...item,
        participantId: String(item._id),
        save: async function () {
          db.participants.set(String(item._id), this);
          return this;
        },
      }));
    return {
      sort: () => ({
        lean: async () => list,
        then: (resolve) => resolve(list),
      }),
      lean: async () => list,
      then: (resolve) => resolve(list),
    };
  };

  Participant.countDocuments = async (filter) => {
    const eventId = filter?.eventId ? String(filter.eventId) : null;
    return Array.from(db.participants.values()).filter((item) => !eventId || item.eventId === eventId).length;
  };

  Participant.aggregate = async () => [];

  Participant.updateOne = async (filter, update) => {
    const targetId = String(filter._id);
    const record = db.participants.get(targetId);
    if (!record) return { modifiedCount: 0 };

    const activityIdToScan = update?.$push?.scannedActivities?.activityId;
    if (activityIdToScan) {
      const alreadyScanned = (record.scannedActivities || []).some(
        (s) => String(s.activityId) === String(activityIdToScan)
      );
      if (alreadyScanned) {
        return { modifiedCount: 0 };
      }
      record.scannedActivities = record.scannedActivities || [];
      record.scannedActivities.push(update.$push.scannedActivities);
      record.pointsAwarded = (record.pointsAwarded || 0) + (update?.$inc?.pointsAwarded || 0);
      record.status = 'checked_in';
      db.participants.set(targetId, record);
      return { modifiedCount: 1 };
    }

    return { modifiedCount: 1 };
  };

  return function restore() {
    Event.prototype.save = originals.eventSave;
    Event.findById = originals.eventFindById;
    Event.findByIdAndUpdate = originals.eventFindByIdAndUpdate;
    Event.find = originals.eventFind;
    Event.countDocuments = originals.eventCountDocuments;
    Event.findByIdAndDelete = originals.eventFindByIdAndDelete;
    Activity.prototype.save = originals.activitySave;
    Activity.findById = originals.activityFindById;
    Activity.findByIdAndUpdate = originals.activityFindByIdAndUpdate;
    Activity.findOne = originals.activityFindOne;
    Activity.find = originals.activityFind;
    Participant.prototype.save = originals.participantSave;
    Participant.findById = originals.participantFindById;
    Participant.findOne = originals.participantFindOne;
    Participant.find = originals.participantFind;
    Participant.countDocuments = originals.participantCountDocuments;
    Participant.updateOne = originals.participantUpdateOne;
    Participant.create = originals.participantCreate;
  };
}

test('Operations Studio & Live Scanner Flow', async (t) => {
  const restoreStubs = installInMemoryModelStubs();

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/v1/events', eventRoutes);
  app.use('/api/v1', baseRoutes);

  const server = await createServer(app);
  const baseUrl = getBaseUrl(server);

  const adminHeaders = buildHeaders({
    role: 'admin',
    scope_type: 'global',
    scope_id: null,
  });

  try {
    // 1. Create Event with custom fields, capacity limit, and audience rule
    const createEventRes = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'AI Summit & Hackathon 2026',
        description: 'Flagship artificial intelligence conference and hackathon',
        location: 'Faculty of Electronic Engineering, Hall 1',
        venue: 'Main Auditorium',
        category: 'Hackathon',
        capacity: 50,
        isRegistrationOpen: true,
        allowedAudience: 'public',
        customFields: [
          {
            id: 'tshirt_size',
            label: 'T-Shirt Size',
            type: 'select',
            options: ['S', 'M', 'L', 'XL'],
            required: true,
            placeholder: 'Select size',
            order: 0,
          },
          {
            id: 'dietary',
            label: 'Dietary Preference',
            type: 'text',
            required: false,
            placeholder: 'Vegetarian, Vegan, etc.',
            order: 1,
          },
        ],
      }),
    });

    assert.equal(createEventRes.status, 201);
    const createEventData = await createEventRes.json();
    const eventId = String(createEventData.event._id || createEventData.event.id);
    assert.ok(eventId);
    assert.equal(createEventData.event.name, 'AI Summit & Hackathon 2026');
    assert.equal(createEventData.event.capacity, 50);
    assert.equal(createEventData.event.customFields.length, 2);

    // Verify default Main Check-In activity was auto-created
    assert.ok(createEventData.defaultActivity);
    assert.equal(createEventData.defaultActivity.name, 'Main Check-In');
    assert.equal(createEventData.defaultActivity.type, 'check-in');
    const mainActivityQrId = createEventData.defaultActivity.qrId;

    // 2. Add sub-activity (Workshop 1)
    const createActRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/activities`, {
      method: 'POST',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Deep Learning Workshop',
        type: 'workshop',
        points: 20,
        isLocked: false,
        checkInMode: 'staff_scanner',
        description: 'Hands-on neural network training',
      }),
    });
    assert.equal(createActRes.status, 201);
    const actData = await createActRes.json();
    const workshopActivityId = String(actData.activity._id || actData.activity.id);
    const workshopQrId = actData.activity.qrId;
    assert.equal(actData.activity.name, 'Deep Learning Workshop');
    assert.equal(actData.activity.points, 20);

    // 3. Test Activity Locking
    const lockRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/activities/${workshopActivityId}/lock`, {
      method: 'PATCH',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ isLocked: true }),
    });
    assert.equal(lockRes.status, 200);
    const lockData = await lockRes.json();
    assert.equal(lockData.activity.isLocked, true);

    // 4. Test Mode Switch on Sub-Activity (to self_service) and unlock it
    const modeRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/activities/${workshopActivityId}/mode`, {
      method: 'PATCH',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ checkInMode: 'self_service' }),
    });
    assert.equal(modeRes.status, 200);
    const modeData = await modeRes.json();
    assert.equal(modeData.activity.checkInMode, 'self_service');

    // Unlock it
    await fetch(`${baseUrl}/api/v1/events/${eventId}/activities/${workshopActivityId}/lock`, {
      method: 'PATCH',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ isLocked: false }),
    });

    // 5. Register participant with custom fields
    // Missing required field -> should return 400
    const failRegRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/participants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Ahmed Youssef',
        email: 'ahmed.youssef@ieee.local',
        phoneNumber: '01012345678',
        university: 'Menoufia University',
        faculty: 'Faculty of Electronic Engineering',
        major: 'Computer Science',
        customResponses: {
          dietary: 'Standard',
        },
      }),
    });
    assert.equal(failRegRes.status, 400);

    // Successful registration with custom fields
    const regRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/participants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Ahmed Youssef',
        email: 'ahmed.youssef@ieee.local',
        phoneNumber: '01012345678',
        university: 'Menoufia University',
        faculty: 'Faculty of Electronic Engineering',
        major: 'Computer Science',
        customResponses: {
          tshirt_size: 'L',
          dietary: 'Standard',
        },
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    const participantId = String(regData.participant._id || regData.participant.id);
    assert.ok(participantId);
    assert.equal(regData.participant.customResponses.tshirt_size, 'L');

    // 6. Test Staff Scanner check-in on Main Check-In using JSON QR payload
    const jsonQrPayload = JSON.stringify({
      ticketId: participantId,
      eventId: eventId,
    });

    const staffScanRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/qr/scan`, {
      method: 'POST',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        ticketId: jsonQrPayload,
        activityQrId: mainActivityQrId,
      }),
    });
    assert.equal(staffScanRes.status, 200);
    const scanData = await staffScanRes.json();
    assert.equal(scanData.participant.name, 'Ahmed Youssef');
    assert.equal(scanData.participant.pointsAwarded, 25);

    // Duplicate scan on same activity -> returns 409 conflict
    const dupScanRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/qr/scan`, {
      method: 'POST',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        ticketId: participantId,
        activityQrId: mainActivityQrId,
      }),
    });
    assert.equal(dupScanRes.status, 409);
    const dupData = await dupScanRes.json();
    assert.equal(dupData.alreadyScanned, true);

    // 7. Test Self-Service Check-In on Workshop (self_service mode)
    const selfCheckinRes = await fetch(`${baseUrl}/api/v1/activities/qr/${workshopQrId}/self-checkin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'ahmed.youssef@ieee.local',
      }),
    });
    assert.equal(selfCheckinRes.status, 200);
    const selfData = await selfCheckinRes.json();
    assert.equal(selfData.participant.pointsAwarded, 45); // 25 + 20

    // 8. Test Attendance Report
    const reportRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/attendance/report`, {
      method: 'GET',
      headers: adminHeaders,
    });
    assert.equal(reportRes.status, 200);
    const reportData = await reportRes.json();
    assert.equal(reportData.summary.participantsTotal, 1);
    assert.equal(reportData.summary.participantsScannedAny, 1);
    assert.equal(reportData.summary.scanRecordsTotal, 2);
    assert.equal(reportData.participants[0].customResponses.tshirt_size, 'L');

    // 9. Test CSV Export contains custom fields and activity logs
    const csvRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/attendance/export`, {
      method: 'GET',
      headers: adminHeaders,
    });
    assert.equal(csvRes.status, 200);
    const csvContent = await csvRes.text();
    assert.ok(csvContent.includes('T-Shirt Size'));
    assert.ok(csvContent.includes('Dietary Preference'));
    assert.ok(csvContent.includes('Ahmed Youssef'));
    assert.ok(csvContent.includes('ahmed.youssef@ieee.local'));
    assert.ok(csvContent.includes('L'));
  } finally {
    restoreStubs();
    await new Promise((resolve) => server.close(resolve));
  }
});
