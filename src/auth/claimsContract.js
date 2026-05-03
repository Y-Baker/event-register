const crypto = require('crypto');
const config = require('../config');

const ALLOWED_ROLES = new Set(['admin', 'organizer', 'scanner']);
const ALLOWED_SCOPE_TYPES = new Set(['global', 'event']);
const MAX_CLAIMS_LIFETIME_SECONDS = config.auth?.maxClaimsLifetimeSeconds || 604800;
const CLAIMS_CLOCK_SKEW_SECONDS = config.auth?.claimsClockSkewSeconds || 30;

function normalizeKey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeInteger(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function resolveNowSeconds(nowSeconds) {
  const parsed = normalizeInteger(nowSeconds);
  if (parsed !== null && parsed >= 0) return parsed;
  return Math.floor(Date.now() / 1000);
}

function resolveClaimsExp(claimsInput, options = {}) {
  const existingExp = normalizeInteger(claimsInput?.exp);
  if (existingExp !== null) {
    return existingExp;
  }

  const ttlSeconds = normalizeInteger(options.ttlSeconds);
  if (ttlSeconds === null || ttlSeconds <= 0) {
    throw new Error('Missing or invalid claims exp');
  }
  if (ttlSeconds > MAX_CLAIMS_LIFETIME_SECONDS + CLAIMS_CLOCK_SKEW_SECONDS) {
    throw new Error('Claims ttlSeconds exceeds maximum window');
  }

  return resolveNowSeconds(options.nowSeconds) + ttlSeconds;
}

function normalizeClaims(input) {
  const role = normalizeKey(input?.role);
  const scopeType = normalizeKey(input?.scope_type || input?.scopeType);
  const rawScopeId = normalizeKey(input?.scope_id || input?.scopeId);
  const exp = normalizeInteger(input?.exp);

  if (!role || !ALLOWED_ROLES.has(role)) {
    throw new Error('Invalid claims role');
  }
  if (!scopeType || !ALLOWED_SCOPE_TYPES.has(scopeType)) {
    throw new Error('Invalid claims scope_type');
  }
  if (scopeType === 'event' && !rawScopeId) {
    throw new Error('Missing claims scope_id for event scope');
  }
  if (exp === null || exp <= 0) {
    throw new Error('Missing or invalid claims exp');
  }

  return {
    role,
    scope_type: scopeType,
    scope_id: scopeType === 'global' ? null : rawScopeId,
    exp,
  };
}

function encodeClaims(claimsInput) {
  const normalized = normalizeClaims(claimsInput);
  return Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url');
}

function safeTimingEquals(a, b) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function signEncodedClaims(rawClaims, secret) {
  const key = normalizeKey(secret);
  if (!key) {
    throw new Error('Claims authentication is not configured');
  }

  return crypto
    .createHmac('sha256', key)
    .update(rawClaims)
    .digest('hex');
}

function buildSignedClaimsHeaders(claimsInput, secret, options = {}) {
  const payload = { ...(claimsInput || {}) };
  payload.exp = resolveClaimsExp(payload, options);

  const rawClaims = encodeClaims(payload);
  const signature = signEncodedClaims(rawClaims, secret);
  return {
    'x-auth-claims': rawClaims,
    'x-auth-signature': signature,
  };
}

function parseClaimsPayload(rawPayload) {
  let decoded;
  try {
    decoded = Buffer.from(rawPayload, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid claims encoding');
  }

  let claims;
  try {
    claims = JSON.parse(decoded);
  } catch {
    throw new Error('Invalid claims payload');
  }

  const normalized = normalizeClaims(claims);
  return {
    role: normalized.role,
    scopeType: normalized.scope_type,
    scopeId: normalized.scope_id,
    exp: normalized.exp,
  };
}

function assertClaimsLifetime(exp, options = {}) {
  const nowSeconds = resolveNowSeconds(options.nowSeconds);
  if (exp + CLAIMS_CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new Error('Claims expired');
  }
  if (exp - nowSeconds > MAX_CLAIMS_LIFETIME_SECONDS + CLAIMS_CLOCK_SKEW_SECONDS) {
    throw new Error('Claims lifetime exceeds maximum window');
  }
}

function verifySignedClaims(rawClaims, signature, secret, options = {}) {
  if (!normalizeKey(rawClaims) || !normalizeKey(signature)) {
    throw new Error('Missing claims or signature header');
  }

  const expected = signEncodedClaims(rawClaims, secret);
  if (!safeTimingEquals(expected, signature)) {
    throw new Error('Invalid claims signature');
  }

  const normalized = parseClaimsPayload(rawClaims);
  assertClaimsLifetime(normalized.exp, options);
  return normalized;
}

module.exports = {
  buildSignedClaimsHeaders,
  verifySignedClaims,
  CLAIMS_CLOCK_SKEW_SECONDS,
  MAX_CLAIMS_LIFETIME_SECONDS,
};
