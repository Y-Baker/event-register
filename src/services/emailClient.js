// Email client for producing events to Redis Stream or direct HTTP fallback.
const { publishToStream } = require('./keydbService');
const config = require('../config');
const { randomUUID } = require('crypto');

const STREAM = config.email.stream;
const EMAIL_SERVICE_URL = config.email.serviceUrl; // e.g. http://localhost:5060
const EMAIL_SERVICE_AUTH_TOKEN = config.email.serviceAuthToken;

function buildPayload({ to, subject, text, templateId, templateVersion, templateVars, attachments, priority }) {
  return {
    schemaVersion: '1.0',
    id: randomUUID(),
    correlationId: randomUUID(),
    to: Array.isArray(to) ? to : [to],
    subject,
    text,
    templateId,
    templateVersion,
    templateVars,
    attachments: (attachments || []).map(a => ({
      filename: a.filename,
      mimeType: a.mimeType || 'application/octet-stream',
      content: a.contentBase64 // email-service expects the base64 payload in `content`
    })),
    priority: priority || 'normal',
    createdAt: new Date().toISOString()
  };
}

async function sendEmailEvent(opts) {
  const payload = buildPayload(opts);
  try {
    await publishToStream(STREAM, payload);
    return { queued: true, id: payload.id };
  } catch (e) {
    // Fallback to direct HTTP if available
    if (EMAIL_SERVICE_URL) {
      const { URL } = require('node:url');
      const parsed = new URL(`${EMAIL_SERVICE_URL}/email/send`);
      const httpLib = parsed.protocol === 'https:' ? require('node:https') : require('node:http');
      const headers = { 'Content-Type': 'application/json' };
      if (EMAIL_SERVICE_AUTH_TOKEN) {
        headers['x-service-token'] = EMAIL_SERVICE_AUTH_TOKEN;
      }
      const options = {
        method: 'POST',
        headers
      };
      return new Promise((resolve, reject) => {
        const req = httpLib.request(parsed, options, res => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            if (res.statusCode && res.statusCode < 300) return resolve({ fallback: true, response: data });
            reject(new Error(`Email service failed: ${res.statusCode}`));
          });
        });
        req.on('error', reject);
        req.write(JSON.stringify(payload));
        req.end();
      });
    }
    throw e;
  }
}

module.exports = { sendEmailEvent };
