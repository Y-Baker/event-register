const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const dotenv = require('dotenv');
dotenv.config();

process.env.AUTH_CLAIMS_HMAC_SECRET = process.env.AUTH_CLAIMS_HMAC_SECRET || 'integration-claims-secret';

const { authMiddleware, requireRole, requireEventScope } = require('../../src/middlewares/auth');
const { buildSignedClaimsHeaders } = require('../../src/auth/claimsContract');
const { registerActivity, sendQRToParticipants } = require('../../src/api/controllers/qrController');
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

function makeJsonRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('auth integration: protected route rejects missing claims headers', async () => {
  const app = express();
  app.use(authMiddleware);
  app.get('/protected', requireRole('admin'), (req, res) => res.status(200).json({ ok: true }));

  const server = await createServer(app);
  try {
    const response = await fetch(`${getBaseUrl(server)}/protected`);
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error, 'Unauthorized');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('auth integration: invalid claims signature is rejected', async () => {
  const app = express();
  app.use(authMiddleware);
  app.get('/protected', requireRole('admin'), (req, res) => res.status(200).json({ ok: true }));

  const claims = buildSignedClaimsHeaders({
    role: 'admin',
    scope_type: 'global',
  }, process.env.AUTH_CLAIMS_HMAC_SECRET);

  const server = await createServer(app);
  try {
    const response = await fetch(`${getBaseUrl(server)}/protected`, {
      headers: {
        'x-auth-claims': claims['x-auth-claims'],
        'x-auth-signature': `${claims['x-auth-signature']}invalid`,
      },
    });
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error, 'Unauthorized');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('auth integration: valid claims allow access', async () => {
  const app = express();
  app.use(authMiddleware);
  app.get('/protected', requireRole('admin'), (req, res) => res.status(200).json({ ok: true }));

  const claims = buildSignedClaimsHeaders({
    role: 'admin',
    scope_type: 'global',
  }, process.env.AUTH_CLAIMS_HMAC_SECRET);

  const server = await createServer(app);
  try {
    const response = await fetch(`${getBaseUrl(server)}/protected`, {
      headers: {
        'x-auth-claims': claims['x-auth-claims'],
        'x-auth-signature': claims['x-auth-signature'],
      },
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('event scope auth: organizer with mismatched event scope is forbidden', async () => {
  const app = express();
  app.use(authMiddleware);
  app.get('/events/:eventId/protected', requireRole('organizer', 'admin'), requireEventScope(), (req, res) => {
    return res.status(200).json({ ok: true });
  });

  const claims = buildSignedClaimsHeaders({
    role: 'organizer',
    scope_type: 'event',
    scope_id: '507f1f77bcf86cd799439099',
  }, process.env.AUTH_CLAIMS_HMAC_SECRET);

  const server = await createServer(app);
  try {
    const response = await fetch(`${getBaseUrl(server)}/events/507f1f77bcf86cd799439011/protected`, {
      headers: {
        'x-auth-claims': claims['x-auth-claims'],
        'x-auth-signature': claims['x-auth-signature'],
      },
    });
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.error, 'Forbidden');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('event scope auth: organizer with matching event scope is allowed', async () => {
  const app = express();
  app.use(authMiddleware);
  app.get('/events/:eventId/protected', requireRole('organizer', 'admin'), requireEventScope(), (req, res) => {
    return res.status(200).json({ ok: true });
  });

  const claims = buildSignedClaimsHeaders({
    role: 'organizer',
    scope_type: 'event',
    scope_id: '507f1f77bcf86cd799439011',
  }, process.env.AUTH_CLAIMS_HMAC_SECRET);

  const server = await createServer(app);
  try {
    const response = await fetch(`${getBaseUrl(server)}/events/507f1f77bcf86cd799439011/protected`, {
      headers: {
        'x-auth-claims': claims['x-auth-claims'],
        'x-auth-signature': claims['x-auth-signature'],
      },
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('scan scope isolation: rejects cross-event activity scans', async () => {
  const originalFindEvent = Event.findById;
  const originalFindActivity = Activity.findOne;
  const originalFindParticipant = Participant.findById;
  const eventId = '507f1f77bcf86cd799439011';

  Event.findById = async () => ({ _id: eventId });
  Participant.findById = async () => ({
    _id: '507f191e810c19729de860ea',
    eventId: { toString: () => eventId },
    scannedActivities: [],
    save: async () => {},
  });
  Activity.findOne = async () => ({
    _id: '507f191e810c19729de860ab',
    eventId: { toString: () => '507f1f77bcf86cd799439012' },
  });

  try {
    const req = {
      params: { eventId },
      body: { ticketId: '507f191e810c19729de860ea', activityQrId: 'qr-1' },
      query: {},
    };
    const res = makeJsonRes();

    await registerActivity(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Activity does not belong to this event');
  } finally {
    Event.findById = originalFindEvent;
    Activity.findOne = originalFindActivity;
    Participant.findById = originalFindParticipant;
  }
});

test('scan contract: query-style input is rejected when body is missing', async () => {
  const originalFindEvent = Event.findById;
  Event.findById = async () => {
    throw new Error('Event lookup should not run when payload is invalid');
  };

  try {
    const req = {
      params: { eventId: '507f1f77bcf86cd799439011' },
      body: {},
      query: { ticketId: 'participant-1', activityId: 'legacy-qr-id' },
    };
    const res = makeJsonRes();

    await registerActivity(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'ticketId and activityQrId are required');
    assert.equal(res.headers.deprecation, undefined);
    assert.equal(res.headers.sunset, undefined);
  } finally {
    Event.findById = originalFindEvent;
  }
});

test('scan validation: invalid eventId returns 400 and fails fast', async () => {
  const originalFindEvent = Event.findById;
  Event.findById = async () => {
    throw new Error('Event lookup should not run when eventId is invalid');
  };

  try {
    const req = {
      params: { eventId: 'not-an-object-id' },
      body: { ticketId: '507f191e810c19729de860ea', activityQrId: 'qr-1' },
    };
    const res = makeJsonRes();

    await registerActivity(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid eventId format');
  } finally {
    Event.findById = originalFindEvent;
  }
});

test('scan validation: invalid ticketId returns 400', async () => {
  const originalFindEvent = Event.findById;
  Event.findById = async () => ({ _id: '507f1f77bcf86cd799439011' });

  try {
    const req = {
      params: { eventId: '507f1f77bcf86cd799439011' },
      body: { ticketId: 'bad-id', activityQrId: 'qr-1' },
    };
    const res = makeJsonRes();

    await registerActivity(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid ticketId format');
  } finally {
    Event.findById = originalFindEvent;
  }
});

test('scan controller hardening: duplicate scan race-safe path returns 409', async () => {
  const originalFindEvent = Event.findById;
  const originalFindActivity = Activity.findOne;
  const originalFindParticipant = Participant.findById;
  const originalUpdateOne = Participant.updateOne;

  Event.findById = async () => ({ _id: '507f1f77bcf86cd799439011' });
  Participant.findById = async () => ({
    _id: '507f191e810c19729de860ea',
    eventId: { toString: () => '507f1f77bcf86cd799439011' },
  });
  Activity.findOne = async () => ({
    _id: '507f191e810c19729de860aa',
    eventId: { toString: () => '507f1f77bcf86cd799439011' },
  });
  Participant.updateOne = async () => ({ matchedCount: 1, modifiedCount: 0 });

  try {
    const req = {
      params: { eventId: '507f1f77bcf86cd799439011' },
      body: {
        ticketId: '507f191e810c19729de860ea',
        activityQrId: 'qr-code-1',
      },
    };
    const res = makeJsonRes();

    await registerActivity(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'Activity already scanned');
  } finally {
    Event.findById = originalFindEvent;
    Activity.findOne = originalFindActivity;
    Participant.findById = originalFindParticipant;
    Participant.updateOne = originalUpdateOne;
  }
});

test('qr send validation: invalid eventId returns 400 and fails fast', async () => {
  const originalFindEvent = Event.findById;
  Event.findById = async () => {
    throw new Error('Event lookup should not run when eventId is invalid');
  };

  try {
    const req = {
      params: { eventId: 'not-an-object-id' },
      body: {},
    };
    const res = makeJsonRes();

    await sendQRToParticipants(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid eventId format');
  } finally {
    Event.findById = originalFindEvent;
  }
});
