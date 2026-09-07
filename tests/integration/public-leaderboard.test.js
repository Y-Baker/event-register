const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');

process.env.AUTH_CLAIMS_HMAC_SECRET = process.env.AUTH_CLAIMS_HMAC_SECRET || 'integration-claims-secret';

const eventRoutes = require('../../src/api/routes/eventRoutes');
const { authMiddleware } = require('../../src/middlewares/auth');
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

function makeObjectIdFactory() {
  let counter = 500;
  return () => new mongoose.Types.ObjectId((counter++).toString(16).padStart(24, '0'));
}

function installInMemoryModelStubs() {
  const nextObjectId = makeObjectIdFactory();
  const db = {
    events: new Map(),
    participants: new Map(),
  };

  const originals = {
    eventFindById: Event.findById,
    participantFind: Participant.find,
    participantFindOne: Participant.findOne,
    participantCountDocuments: Participant.countDocuments,
  };

  Event.findById = (id) => ({
    select: () => ({
      exec: async () => db.events.get(String(id)) || null,
      then: (resolve, reject) => Event.findById(id).select().exec().then(resolve, reject),
    }),
    exec: async () => db.events.get(String(id)) || null,
    then: (resolve, reject) => Event.findById(id).exec().then(resolve, reject),
  });

  Participant.find = (query = {}) => {
    const list = Array.from(db.participants.values()).filter((p) => {
      if (query.eventId && String(p.eventId) !== String(query.eventId)) return false;
      return true;
    });

    const chain = {
      select: () => chain,
      sort: () => chain,
      lean: async () => list.sort((a, b) => (b.pointsAwarded || 0) - (a.pointsAwarded || 0)),
      exec: async () => list.sort((a, b) => (b.pointsAwarded || 0) - (a.pointsAwarded || 0)),
      then: (resolve, reject) => chain.lean().then(resolve, reject),
    };
    return chain;
  };

  Participant.findOne = (query = {}) => {
    const list = Array.from(db.participants.values()).filter((p) => {
      if (query.eventId && String(p.eventId) !== String(query.eventId)) return false;
      if (query.email && String(p.email).toLowerCase() !== String(query.email).toLowerCase()) return false;
      return true;
    });
    const found = list[0] || null;

    const chain = {
      select: () => chain,
      lean: async () => found,
      exec: async () => found,
      then: (resolve, reject) => chain.lean().then(resolve, reject),
    };
    return chain;
  };

  Participant.countDocuments = async (query = {}) => {
    const list = Array.from(db.participants.values()).filter((p) => {
      if (query.eventId && String(p.eventId) !== String(query.eventId)) return false;
      if (query.$or) {
        return query.$or.some((clause) => {
          if (clause.pointsAwarded?.$gt !== undefined) {
            return (p.pointsAwarded || 0) > clause.pointsAwarded.$gt;
          }
          return false;
        });
      }
      return true;
    });
    return list.length;
  };

  return {
    db,
    nextObjectId,
    restore() {
      Event.findById = originals.eventFindById;
      Participant.find = originals.participantFind;
      Participant.findOne = originals.participantFindOne;
      Participant.countDocuments = originals.participantCountDocuments;
    },
  };
}

test('Public Leaderboard: rank listing and personal rank lookup', async (t) => {
  const stubs = installInMemoryModelStubs();
  t.after(() => stubs.restore());

  const eventId = stubs.nextObjectId();
  const event = {
    _id: eventId,
    name: 'IEEE AI Summit 2026',
    description: 'Premier AI conference in Menoufia',
    startDate: new Date('2026-10-15T09:00:00Z'),
    endDate: new Date('2026-10-15T18:00:00Z'),
    venue: 'Faculty of Electronic Engineering Hall A',
    coverImageUrl: 'https://example.com/ai-summit.jpg',
    status: 'published',
  };
  stubs.db.events.set(String(eventId), event);

  // Seed participants with points
  const p1 = {
    _id: stubs.nextObjectId(),
    eventId,
    name: 'Yousef Ahmed',
    email: 'yousef@example.com',
    phoneNumber: '+201000000001',
    pointsAwarded: 120,
    scannedActivities: [
      { activityTitle: 'Keynote Talk', pointsEarned: 50, scannedAt: new Date() },
      { activityTitle: 'AI Workshop', pointsEarned: 70, scannedAt: new Date() },
    ],
    createdAt: new Date('2026-09-01T10:00:00Z'),
  };
  const p2 = {
    _id: stubs.nextObjectId(),
    eventId,
    name: 'Fatma Ali',
    email: 'fatma@example.com',
    phoneNumber: '+201000000002',
    pointsAwarded: 95,
    scannedActivities: [
      { activityTitle: 'Keynote Talk', pointsEarned: 50, scannedAt: new Date() },
      { activityTitle: 'Poster Session', pointsEarned: 45, scannedAt: new Date() },
    ],
    createdAt: new Date('2026-09-01T10:05:00Z'),
  };
  const p3 = {
    _id: stubs.nextObjectId(),
    eventId,
    name: 'Omar Hassan',
    email: 'omar@example.com',
    phoneNumber: '+201000000003',
    pointsAwarded: 60,
    scannedActivities: [
      { activityTitle: 'Keynote Talk', pointsEarned: 50, scannedAt: new Date() },
      { activityTitle: 'Exhibition Booth', pointsEarned: 10, scannedAt: new Date() },
    ],
    createdAt: new Date('2026-09-01T10:10:00Z'),
  };
  const p4 = {
    _id: stubs.nextObjectId(),
    eventId,
    name: 'Nour El-Din',
    email: 'nour@example.com',
    phoneNumber: '+201000000004',
    pointsAwarded: 30,
    scannedActivities: [
      { activityTitle: 'Exhibition Booth', pointsEarned: 30, scannedAt: new Date() },
    ],
    createdAt: new Date('2026-09-01T10:15:00Z'),
  };

  stubs.db.participants.set(String(p1._id), p1);
  stubs.db.participants.set(String(p2._id), p2);
  stubs.db.participants.set(String(p3._id), p3);
  stubs.db.participants.set(String(p4._id), p4);

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/v1/events', eventRoutes);
  app.use('/api/events', eventRoutes);

  const server = await createServer(app);
  t.after(() => server.close());
  const baseUrl = getBaseUrl(server);

  // 1. Fetch public leaderboard without any auth headers
  const resLeaderboard = await fetch(`${baseUrl}/api/v1/events/${eventId}/leaderboard`);
  assert.equal(resLeaderboard.status, 200);
  const dataLeaderboard = await resLeaderboard.json();

  assert.equal(dataLeaderboard.success, true);
  assert.equal(dataLeaderboard.event.name, 'IEEE AI Summit 2026');
  assert.equal(dataLeaderboard.stats.totalParticipants, 4);
  assert.equal(dataLeaderboard.stats.totalPointsDistributed, 305);

  // Check rankings order
  assert.equal(dataLeaderboard.leaderboard.length, 4);
  assert.equal(dataLeaderboard.leaderboard[0].name, 'Yousef Ahmed');
  assert.equal(dataLeaderboard.leaderboard[0].pointsAwarded, 120);
  assert.equal(dataLeaderboard.leaderboard[0].rank, 1);

  assert.equal(dataLeaderboard.leaderboard[1].name, 'Fatma Ali');
  assert.equal(dataLeaderboard.leaderboard[1].pointsAwarded, 95);
  assert.equal(dataLeaderboard.leaderboard[1].rank, 2);

  // Verify privacy: emails and phone numbers must NOT exist in leaderboard items
  for (const item of dataLeaderboard.leaderboard) {
    assert.equal(item.email, undefined);
    assert.equal(item.phoneNumber, undefined);
    assert.equal(item._id, undefined);
  }

  // Check podium
  assert.equal(dataLeaderboard.podium.length, 3);
  assert.equal(dataLeaderboard.podium[0].name, 'Yousef Ahmed');
  assert.equal(dataLeaderboard.podium[1].name, 'Fatma Ali');
  assert.equal(dataLeaderboard.podium[2].name, 'Omar Hassan');

  // 2. Fetch via alias /api/events/:eventId/leaderboard
  const resAlias = await fetch(`${baseUrl}/api/events/${eventId}/leaderboard`);
  assert.equal(resAlias.status, 200);
  const dataAlias = await resAlias.json();
  assert.equal(dataAlias.leaderboard.length, 4);

  // 3. Lookup individual rank by email
  const resMyRank = await fetch(`${baseUrl}/api/v1/events/${eventId}/leaderboard/my-rank?email=fatma@example.com`);
  assert.equal(resMyRank.status, 200);
  const dataMyRank = await resMyRank.json();

  assert.equal(dataMyRank.success, true);
  assert.equal(dataMyRank.participant.name, 'Fatma Ali');
  assert.equal(dataMyRank.participant.pointsAwarded, 95);
  assert.equal(dataMyRank.participant.rank, 2);
  assert.equal(dataMyRank.participant.completedActivitiesCount, 2);
  assert.equal(dataMyRank.participant.scannedActivities.length, 2);

  // 4. Lookup non-existent email returns 404
  const resNotFound = await fetch(`${baseUrl}/api/v1/events/${eventId}/leaderboard/my-rank?email=unknown@example.com`);
  assert.equal(resNotFound.status, 404);
});
