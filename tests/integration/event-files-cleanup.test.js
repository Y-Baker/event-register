const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const mongoose = require('mongoose');

process.env.AUTH_CLAIMS_HMAC_SECRET = process.env.AUTH_CLAIMS_HMAC_SECRET || 'integration-claims-secret';

const Event = require('../../src/models/Event');
const Activity = require('../../src/models/Activity');
const Participant = require('../../src/models/Participant');
const eventRoutes = require('../../src/api/routes/eventRoutes');
const { authMiddleware } = require('../../src/middlewares/auth');
const { buildSignedClaimsHeaders } = require('../../src/auth/claimsContract');
const fileClient = require('../../src/services/fileClient');

function createServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function getBaseUrl(server) {
  const addr = server.address();
  return `http://127.0.0.1:${addr.port}`;
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function buildHeaders(claims) {
  return buildSignedClaimsHeaders({
    ...claims,
    exp: claims.exp ?? (unixNow() + 300),
  }, process.env.AUTH_CLAIMS_HMAC_SECRET);
}

test('event files cleanup integration: calls file-service on event delete and image replacement', async () => {
  const deletedUrlsFromService = [];

  // 1. Mock file-service server
  const mockFileApp = express();
  mockFileApp.use(express.json());
  mockFileApp.delete('/api/files/by-url', (req, res) => {
    deletedUrlsFromService.push(req.body?.url);
    res.status(200).json({ success: true, url: req.body?.url });
  });

  const mockFileServer = await createServer(mockFileApp);
  const mockFileServiceUrl = getBaseUrl(mockFileServer);
  process.env.FILE_SERVICE_URL = mockFileServiceUrl;

  // 2. Mock event-register Express app
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/v1/events', eventRoutes);
  const eventServer = await createServer(app);

  // 3. In-memory stubs for Event, Activity, Participant
  const eventId = new mongoose.Types.ObjectId().toString();
  let storedEvent = {
    _id: eventId,
    name: 'Hackathon 2026',
    description: 'Annual Engineering Hackathon',
    location: 'Faculty of Electronic Engineering',
    coverImageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/hackathon-cover.jpg',
    bannerUrl: 'https://res.cloudinary.com/demo/image/upload/v1/hackathon-banner.jpg',
    status: 'published',
  };

  const origFindById = Event.findById;
  const origFindByIdAndUpdate = Event.findByIdAndUpdate;
  const origFindByIdAndDelete = Event.findByIdAndDelete;
  const origDeleteManyAct = Activity.deleteMany;
  const origDeleteManyPart = Participant.deleteMany;

  Event.findById = (id) => ({
    select: async () => (String(id) === eventId ? { ...storedEvent } : null),
  });

  Event.findByIdAndUpdate = async (id, update) => {
    if (String(id) === eventId) {
      storedEvent = { ...storedEvent, ...update.$set };
      return { ...storedEvent };
    }
    return null;
  };

  Event.findByIdAndDelete = async (id) => {
    if (String(id) === eventId) {
      const removed = { ...storedEvent };
      storedEvent = null;
      return removed;
    }
    return null;
  };

  Activity.deleteMany = async () => ({ deletedCount: 0 });
  Participant.deleteMany = async () => ({ deletedCount: 0 });

  try {
    // Direct fileClient check
    const clientRes = await fileClient.deleteFileByUrl('https://res.cloudinary.com/demo/image/upload/v1/direct-test.jpg');
    assert.equal(clientRes.success, true);
    assert.ok(deletedUrlsFromService.includes('https://res.cloudinary.com/demo/image/upload/v1/direct-test.jpg'));

    // Admin headers for event-register API
    const adminHeaders = buildHeaders({
      role: 'admin',
      scopeType: 'global',
      scopeId: null,
    });

    // Test 1: PATCH event with new coverImageUrl -> triggers deletion of old cover
    const patchRes = await fetch(`${getBaseUrl(eventServer)}/api/v1/events/${eventId}`, {
      method: 'PATCH',
      headers: {
        ...adminHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        coverImageUrl: 'https://res.cloudinary.com/demo/image/upload/v2/hackathon-cover-updated.jpg',
      }),
    });
    assert.equal(patchRes.status, 200);

    // Give asynchronous deletion call a tick to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(
      deletedUrlsFromService.includes('https://res.cloudinary.com/demo/image/upload/v1/hackathon-cover.jpg'),
      'Old cover image should be requested for deletion in file-service'
    );

    // Test 2: DELETE event -> triggers deletion of updated cover and existing banner
    const deleteRes = await fetch(`${getBaseUrl(eventServer)}/api/v1/events/${eventId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    assert.equal(deleteRes.status, 200);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(
      deletedUrlsFromService.includes('https://res.cloudinary.com/demo/image/upload/v2/hackathon-cover-updated.jpg'),
      'Updated cover image should be deleted when event is removed'
    );
    assert.ok(
      deletedUrlsFromService.includes('https://res.cloudinary.com/demo/image/upload/v1/hackathon-banner.jpg'),
      'Banner image should be deleted when event is removed'
    );
  } finally {
    Event.findById = origFindById;
    Event.findByIdAndUpdate = origFindByIdAndUpdate;
    Event.findByIdAndDelete = origFindByIdAndDelete;
    Activity.deleteMany = origDeleteManyAct;
    Participant.deleteMany = origDeleteManyPart;

    await new Promise((resolve) => eventServer.close(resolve));
    await new Promise((resolve) => mockFileServer.close(resolve));
  }
});
