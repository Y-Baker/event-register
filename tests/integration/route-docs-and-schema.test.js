const test = require('node:test');
const assert = require('node:assert/strict');

const { getAllRoutes } = require('../../src/api/controllers/baseController');
const Participant = require('../../src/models/Participant');

function makeJsonRes() {
  return {
    statusCode: 200,
    body: null,
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

test('route docs regression: exposes canonical event-scoped route paths', () => {
  const res = makeJsonRes();
  getAllRoutes({}, res);

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.routes));

  const routes = res.body.routes.map((route) => `${route.method} ${route.path}`);
  const routeSet = new Set(routes);

  assert.ok(routeSet.has('POST /api/v1/events/:eventId/qr/scan'));
  assert.ok(routeSet.has('POST /api/v1/events/:eventId/qr/send'));
  assert.ok(routeSet.has('POST /api/v1/events/:eventId/participants/upload'));
  assert.ok(routeSet.has('GET /api/v1/events/:eventId/attendance/report'));
  assert.ok(routeSet.has('GET /api/v1/events/:eventId/attendance/export'));

  for (const route of routes) {
    assert.equal(route.includes('/api/v1/events/:id'), false);
    assert.equal(route.includes('/register-activity'), false);
    assert.equal(route.includes('/enents'), false);
  }
});

test('route docs regression: write operations are not documented as GET', () => {
  const res = makeJsonRes();
  getAllRoutes({}, res);

  const qrRoutes = res.body.routes.filter((route) => route.path.includes('/qr/'));
  const qrWrites = qrRoutes.filter((route) => route.method === 'POST');
  const qrReads = qrRoutes.filter((route) => route.method === 'GET');

  assert.equal(qrWrites.length >= 2, true);
  assert.equal(qrReads.length, 0);
});

test('participant schema contract: email is required and normalized', () => {
  const emailPath = Participant.schema.path('email');
  assert.equal(emailPath.options.required, true);
  assert.equal(emailPath.options.trim, true);
  assert.equal(emailPath.options.lowercase, true);
});

test('participant schema contract: eventId+email unique index exists', () => {
  const indexes = Participant.schema.indexes();
  const match = indexes.find(([fields]) => fields.eventId === 1 && fields.email === 1);

  assert.ok(match, 'Expected unique index on (eventId, email)');
  const [, options] = match;
  assert.equal(options.unique, true);
});
