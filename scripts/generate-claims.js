#!/usr/bin/env node
/*
Generate signed auth headers for the event-register service.

Usage:
  AUTH_CLAIMS_HMAC_SECRET=yoursecret node scripts/generate-claims.js --role=organizer --scope_type=event --scope_id=<eventId> --ttl=900

Or rely on AUTH_CLAIMS_HMAC_SECRET from env and pass flags.
*/

const { buildSignedClaimsHeaders } = require('../src/auth/claimsContract');

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    out[k] = v === undefined ? true : v;
  }
  return out;
}

function usageAndExit(code = 1) {
  console.log('\nUsage: AUTH_CLAIMS_HMAC_SECRET=<secret> node scripts/generate-claims.js --role=organizer --scope_type=event --scope_id=<eventId> [--ttl=900]\n');
  process.exit(code);
}

async function main() {
  const args = parseArgs();
  const secret = process.env.AUTH_CLAIMS_HMAC_SECRET || args.secret;
  if (!secret) {
    console.error('ERROR: AUTH_CLAIMS_HMAC_SECRET must be provided as env or --secret.');
    usageAndExit(2);
  }

  const role = args.role || 'organizer';
  const scope_type = args.scope_type || args.scopeType || 'event';
  const scope_id = args.scope_id || args.scopeId || null;
  const ttl = args.ttl ? parseInt(args.ttl, 10) : 900; // default 15 minutes

  const claims = {
    role,
    scope_type,
    ...(scope_id ? { scope_id } : {}),
  };

  try {
    const headers = buildSignedClaimsHeaders(claims, secret, { ttlSeconds: ttl });

    console.log('Generated headers:\n');
    console.log('x-auth-claims:', headers['x-auth-claims']);
    console.log('x-auth-signature:', headers['x-auth-signature']);

    const host = process.env.EXAMPLE_HOST || 'http://localhost:5000';
    console.log('\nExample curl using the headers:');
    console.log(`curl -X GET ${host}/api/v1/events -H "x-auth-claims: ${headers['x-auth-claims']}" -H "x-auth-signature: ${headers['x-auth-signature']}"`);

  } catch (err) {
    console.error('Failed to build signed claims headers:', err && err.message ? err.message : err);
    process.exit(3);
  }
}

main();
