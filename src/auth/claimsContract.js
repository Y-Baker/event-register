const crypto = require('crypto');

const ALLOWED_ROLES = new Set(['admin', 'organizer', 'scanner']);
const ALLOWED_SCOPE_TYPES = new Set(['global', 'event']);

function normalizeKey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeClaims(input) {
  const role = normalizeKey(input?.role);
  const scopeType = normalizeKey(input?.scope_type || input?.scopeType);
  const rawScopeId = normalizeKey(input?.scope_id || input?.scopeId);

  if (!role || !ALLOWED_ROLES.has(role)) {
    throw new Error('Invalid claims role');
  }
  if (!scopeType || !ALLOWED_SCOPE_TYPES.has(scopeType)) {
    throw new Error('Invalid claims scope_type');
  }
  if (scopeType === 'event' && !rawScopeId) {
    throw new Error('Missing claims scope_id for event scope');
  }

  return {
    role,
    scope_type: scopeType,
    scope_id: scopeType === 'global' ? null : rawScopeId,
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

function buildSignedClaimsHeaders(claimsInput, secret) {
  const rawClaims = encodeClaims(claimsInput);
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
  };
}

function verifySignedClaims(rawClaims, signature, secret) {
  if (!normalizeKey(rawClaims) || !normalizeKey(signature)) {
    throw new Error('Missing claims or signature header');
  }

  const expected = signEncodedClaims(rawClaims, secret);
  if (!safeTimingEquals(expected, signature)) {
    throw new Error('Invalid claims signature');
  }

  return parseClaimsPayload(rawClaims);
}

module.exports = {
  buildSignedClaimsHeaders,
  verifySignedClaims,
};
