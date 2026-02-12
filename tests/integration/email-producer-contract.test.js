const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

function withEmailClient(publishImpl, envOverrides = {}) {
  const envKeys = ['REDIS_STREAM_EMAIL', 'EMAIL_SERVICE_URL', 'EMAIL_SERVICE_AUTH_TOKEN'];
  const originalEnv = {};
  for (const key of envKeys) {
    originalEnv[key] = process.env[key];
  }

  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const configPath = require.resolve('../../src/config');
  const keydbPath = require.resolve('../../src/services/keydbService');
  const clientPath = require.resolve('../../src/services/emailClient');

  delete require.cache[configPath];
  delete require.cache[clientPath];

  const keydbModule = require(keydbPath);
  const originalPublishToStream = keydbModule.publishToStream;
  keydbModule.publishToStream = publishImpl;

  const { sendEmailEvent } = require(clientPath);

  return {
    sendEmailEvent,
    restore() {
      keydbModule.publishToStream = originalPublishToStream;
      delete require.cache[clientPath];
      delete require.cache[configPath];

      for (const key of envKeys) {
        const value = originalEnv[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
  };
}

function createCaptureServer() {
  let resolver;
  const requestPromise = new Promise((resolve) => {
    resolver = resolve;
  });

  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', () => {
      resolver({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: rawBody,
      });
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    });
  });

  return { server, requestPromise };
}

test('email producer contract: stream payload includes schemaVersion and mapped attachment content', async () => {
  let published = null;

  const harness = withEmailClient(
    async (stream, payload) => {
      published = { stream, payload };
    },
    {
      REDIS_STREAM_EMAIL: 'internal-contract',
      EMAIL_SERVICE_URL: undefined,
      EMAIL_SERVICE_AUTH_TOKEN: undefined,
    }
  );

  try {
    const result = await harness.sendEmailEvent({
      to: 'alice@example.com',
      subject: 'QR Code',
      text: 'Scan this QR',
      attachments: [
        {
          filename: 'ticket.png',
          mimeType: 'image/png',
          contentBase64: 'YWJjMTIz',
        },
      ],
    });

    assert.equal(result.queued, true);
    assert.ok(result.id);

    assert.ok(published);
    assert.equal(published.stream, 'internal-contract');
    assert.equal(published.payload.schemaVersion, '1.0');
    assert.deepEqual(published.payload.to, ['alice@example.com']);
    assert.equal(published.payload.attachments.length, 1);
    assert.equal(published.payload.attachments[0].filename, 'ticket.png');
    assert.equal(published.payload.attachments[0].mimeType, 'image/png');
    assert.equal(published.payload.attachments[0].content, 'YWJjMTIz');
  } finally {
    harness.restore();
  }
});

test('email producer contract: HTTP fallback uses x-service-token header', async () => {
  const { server, requestPromise } = createCaptureServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address();
  const harness = withEmailClient(
    async () => {
      throw new Error('Redis unavailable');
    },
    {
      REDIS_STREAM_EMAIL: 'internal',
      EMAIL_SERVICE_URL: `http://127.0.0.1:${port}`,
      EMAIL_SERVICE_AUTH_TOKEN: 'integration-service-token',
    }
  );

  try {
    const response = await harness.sendEmailEvent({
      to: ['bob@example.com'],
      subject: 'Fallback Send',
      text: 'Fallback path',
      attachments: [
        {
          filename: 'qrcode.png',
          contentBase64: 'cXItY29udGVudA==',
        },
      ],
    });

    const request = await requestPromise;
    const parsedBody = JSON.parse(request.body);

    assert.equal(response.fallback, true);
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/email/send');
    assert.equal(request.headers['x-service-token'], 'integration-service-token');

    assert.equal(parsedBody.schemaVersion, '1.0');
    assert.equal(Array.isArray(parsedBody.attachments), true);
    assert.equal(parsedBody.attachments[0].content, 'cXItY29udGVudA==');
    assert.equal(parsedBody.attachments[0].mimeType, 'application/octet-stream');
  } finally {
    harness.restore();
    await new Promise((resolve) => server.close(resolve));
  }
});
