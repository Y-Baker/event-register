const config = require('../config');
const { verifySignedClaims } = require('../auth/claimsContract');

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeKey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function assertAuthConfig() {
  if (!normalizeKey(config.auth?.claimsHmacSecret)) {
    throw new Error('Missing required AUTH_CLAIMS_HMAC_SECRET');
  }
}

function parseSignedClaims(req) {
  const rawClaims = normalizeKey(normalizeHeaderValue(req.headers['x-auth-claims']));
  const signature = normalizeKey(normalizeHeaderValue(req.headers['x-auth-signature']));

  if (!rawClaims && !signature) return null;
  if (!rawClaims || !signature) {
    throw new Error('Missing claims or signature header');
  }

  const secret = normalizeKey(config.auth?.claimsHmacSecret);
  if (!secret) {
    const err = new Error('Claims authentication is not configured');
    err.code = 'AUTH_CONFIG';
    throw err;
  }

  return verifySignedClaims(rawClaims, signature, secret);
}

const authMiddleware = async (req, res, next) => {
  try {
    const claims = parseSignedClaims(req);
    if (claims) {
      console.log(
        `[auth] verified claims for ${req.method} ${req.originalUrl} role=${claims.role} scopeType=${claims.scopeType} scopeId=${claims.scopeId ?? 'null'} exp=${claims.exp}`
      );
      req.auth = {
        role: claims.role,
        scopeType: claims.scopeType,
        scopeId: claims.scopeId,
        exp: claims.exp,
        source: 'claims',
        authReady: true,
      };
      return next();
    }

    req.auth = { role: 'anonymous', authReady: true };
    console.log(`[auth] no claims headers for ${req.method} ${req.originalUrl}; continuing as anonymous`);
    return next();
  } catch (err) {
    console.warn(
      `[auth] claims verification failed for ${req.method} ${req.originalUrl}: ${err.message}`
    );
    if (err.code === 'AUTH_CONFIG') {
      req.auth = { role: 'anonymous', authReady: false, error: err.message };
      return next();
    }

    req.auth = { role: 'anonymous', authReady: true, error: err.message };
    return next();
  }
}

const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.auth || req.auth.authReady === false) {
      return res.status(503).json({ error: 'Authorization subsystem unavailable' });
    }
    if (!req.auth || !req.auth.role) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (req.auth.role === 'anonymous') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const role = req.auth.role;
    if (role === 'admin') {
      return next();
    }

    const effectiveAllowed = new Set(allowedRoles);
    if (effectiveAllowed.has('organizer') || effectiveAllowed.has('event_organizer')) {
      effectiveAllowed.add('lead');
      effectiveAllowed.add('officer');
      effectiveAllowed.add('event_organizer');
      effectiveAllowed.add('organizer');
    }
    if (effectiveAllowed.has('scanner') || effectiveAllowed.has('event_scanner')) {
      effectiveAllowed.add('scanner');
      effectiveAllowed.add('event_scanner');
      effectiveAllowed.add('lead');
      effectiveAllowed.add('officer');
    }

    if (!effectiveAllowed.has(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
};

const requireEventScope = () => {
  return (req, res, next) => {
    if (!req.auth || req.auth.authReady === false) {
      return res.status(503).json({ error: 'Authorization subsystem unavailable' });
    }
    if (!req.auth || !req.auth.role || req.auth.role === 'anonymous') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const eventId = normalizeKey(req.params?.eventId);
    if (!eventId) {
      return res.status(400).json({ error: 'Invalid eventId format' });
    }

    if (req.auth.role === 'admin') {
      return next();
    }
    if (req.auth.scopeType === 'global') {
      return next();
    }
    if (req.auth.scopeType === 'committee') {
      return next();
    }
    if (req.auth.scopeType === 'event') {
      if (normalizeKey(req.auth.scopeId) === eventId) {
        return next();
      }
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.status(403).json({ error: 'Forbidden' });
  };
};

module.exports = {
  authMiddleware,
  assertAuthConfig,
  requireRole,
  requireEventScope,
};
