# Event Registration Service Usage Guide

This service manages events, activities, participants, QR-code check-in, attendance reporting, and admin key management.

## What You Need

- Node.js dependencies installed with `npm install`.
- MongoDB available through `MONGO_URI`.
- Redis available through `REDIS_URL` or `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD`.
- `AUTH_CLAIMS_HMAC_SECRET` configured so signed auth claims can be verified.
- Optional `MAX_CLAIMS_LIFETIME_SECONDS` and `CLAIMS_CLOCK_SKEW_SECONDS` in `.env` if you want to override the default claim window.
- Optional email delivery integration through `REDIS_STREAM_EMAIL` and `EMAIL_SERVICE_URL`.

## Run Locally

From the service directory:

```bash
npm install
npm run dev
```

The service listens on port `5000` by default. Set `PORT` to override it.

## Authentication Model

Most write and scoped read operations require signed claims headers:

- `x-auth-claims`: base64url-encoded JSON claims
- `x-auth-signature`: HMAC-SHA256 signature of the claims payload

The claims must include:

- `role`: `admin`, `organizer`, or `scanner`
- `scope_type`: `global` or `event`
- `scope_id`: required for event-scoped claims
- `exp`: Unix time in seconds

Use the gateway helper `buildSignedClaimsHeaders(...)` from `src/auth/claimsContract.js` to generate matching headers.

## Endpoint Map

### Public or Lightweight Endpoints

- `GET /api/v1/health` - API health
- `GET /api/v1/health/db` - MongoDB health
- `GET /api/v1/health/redis` - Redis health
- `GET /api/v1/events` - List events
- `GET /api/v1/events/:eventId` - Get one event

### Event Management

- `POST /api/v1/events` - Create event
- `DELETE /api/v1/events/:eventId` - Delete event

Required fields for event creation:

```json
{
  "name": "IEEE Day",
  "description": "Annual student branch event",
  "date": "2026-05-03T10:00:00Z",
  "location": "Main Hall"
}
```

### Activities

- `GET /api/v1/events/:eventId/activities` - List activities
- `POST /api/v1/events/:eventId/activities` - Create activity
- `GET /api/v1/events/:eventId/activities/:activityId` - Get activity

Activity creation accepts:

```json
{
  "name": "Check-in Desk",
  "type": "Check-In"
}
```

Allowed activity types are `Check-In`, `Meal`, `Workshop`, and `Talk`.

### Participants

- `POST /api/v1/events/:eventId/participants` - Add one participant
- `GET /api/v1/events/:eventId/participants` - List participants
- `GET /api/v1/events/:eventId/participants/:participantId` - Get one participant
- `POST /api/v1/events/:eventId/participants/upload` - Bulk upload participants from CSV

The single-participant request body uses `phoneNumber`, not `phone`:

```json
{
  "name": "Yousef Ahmed",
  "email": "yousef@example.com",
  "phoneNumber": "+20123456789",
  "university": "Menoufia University",
  "faculty": "Engineering",
  "major": "Computer Engineering"
}
```

CSV uploads must be sent as multipart form data with a `file` field. The importer accepts column names such as:

- `name` or `Name`
- `email` or `Email`
- `phoneNumber`, `Phone`, or `Number`
- `university` or `University`
- `faculty` or `Faculty`
- `major` or `Major`

### QR and Attendance

- `POST /api/v1/events/:eventId/qr/send` - Generate QR codes and send them to participants
- `POST /api/v1/events/:eventId/qr/scan` - Register a scan for a participant and activity
- `GET /api/v1/events/:eventId/attendance/report` - JSON attendance report
- `GET /api/v1/events/:eventId/attendance/export` - CSV attendance export

QR send uses the email service integration when available. Each participant gets a QR attachment with their participant ID encoded in the image.

Scan requests require:

```json
{
  "ticketId": "participant-id",
  "activityQrId": "activity-qr-id"
}
```

### Admin Keys

- `GET /api/v1/admin/keys` - View stored organizer and scanner keys
- `GET /api/v1/admin/keys/:KeyName` - View a specific key
- `POST /api/v1/admin/keys/:KeyName/issue` - Issue a new key value

`KeyName` must be `organizer` or `scanner`.

## Recommended Usage Flow

1. Create an event.
2. Create the activities for that event.
3. Add participants individually or upload a CSV file.
4. Send QR codes to participants.
5. Scan QR codes during the event.
6. Export the attendance report after the event.

## Example Requests

Create an event:

```bash
curl -X POST http://localhost:5000/api/v1/events \
  -H 'Content-Type: application/json' \
  -H 'x-auth-claims: <base64url-claims>' \
  -H 'x-auth-signature: <signature>' \
  -d '{"name":"IEEE Day","description":"Annual event","date":"2026-05-03T10:00:00Z","location":"Main Hall"}'
```

Add a participant:

```bash
curl -X POST http://localhost:5000/api/v1/events/<eventId>/participants \
  -H 'Content-Type: application/json' \
  -H 'x-auth-claims: <base64url-claims>' \
  -H 'x-auth-signature: <signature>' \
  -d '{"name":"Yousef Ahmed","email":"yousef@example.com","phoneNumber":"+20123456789"}'
```

Send QR codes:

```bash
curl -X POST http://localhost:5000/api/v1/events/<eventId>/qr/send \
  -H 'Content-Type: application/json' \
  -H 'x-auth-claims: <base64url-claims>' \
  -H 'x-auth-signature: <signature>'
```

Scan a participant:

```bash
curl -X POST http://localhost:5000/api/v1/events/<eventId>/qr/scan \
  -H 'Content-Type: application/json' \
  -H 'x-auth-claims: <base64url-claims>' \
  -H 'x-auth-signature: <signature>' \
  -d '{"ticketId":"<participantId>","activityQrId":"<activityQrId>"}'
```

## Notes From Review

- The README example previously used `phone`, but the API expects `phoneNumber` for manual participant creation.
- The CSV importer is more permissive and maps `Phone` or `Number` into `phoneNumber`.
- The service root route `GET /api/v1/` is admin-only; health checks are the safest unauthenticated entry points for smoke testing.

## Deployment (step-by-step)

This section covers deploying the service with Docker Compose (recommended for local and small installs) and brief production notes.

1. Prepare environment variables. Create a `.env` file in the service folder or export variables in your environment. Minimal example:

```env
# Service
PORT=5050
NODE_ENV=production

# MongoDB
MONGO_URI=mongodb://mongo:27017/ieee-registration

# Redis (used for streams and role keys)
REDIS_PASSWORD=change-me-strong-password
REDIS_URL=redis://:change-me-strong-password@redis:6379
REDIS_STREAM_EMAIL=internal

# Auth claims HMAC secret (required)
AUTH_CLAIMS_HMAC_SECRET=replace-with-a-very-long-secret

# Role key names (used as Redis keys)
ORGANIZER_ID=IEEE-ORGANIZER-API-KEY
SCANNER_ID=IEEE-SCANNER-API-KEY

# Email service fallback (optional)
EMAIL_SERVICE_URL=http://email-service:5060
EMAIL_SERVICE_AUTH_TOKEN=replace-with-email-service-token
```

2. Start with Docker Compose (provided in the repo):

```bash
cd services/event-register
docker compose up -d --build
```

3. Watch logs and verify health:

```bash
docker compose logs -f app
curl http://localhost:5050/api/v1/health
curl http://localhost:5050/api/v1/health/db
curl http://localhost:5050/api/v1/health/redis
```

4. If you use external managed MongoDB/Redis, set `MONGO_URI` and `REDIS_URL` accordingly and remove the local `mongo`/`redis` services from your compose or use separate stacks.

5. Sending emails: the service enqueues to Redis stream defined by `REDIS_STREAM_EMAIL`. Ensure the email-service is running and configured with the same Redis or provide `EMAIL_SERVICE_URL` + `EMAIL_SERVICE_AUTH_TOKEN` for HTTP fallback.

6. Updating / rolling restart:

```bash
docker compose pull
docker compose up -d --no-deps --build app
```

Production recommendations

- Use a managed MongoDB (Atlas, Azure Cosmos, etc.) and managed Redis for reliability.
- Store secrets (AUTH_CLAIMS_HMAC_SECRET, EMAIL_SERVICE_AUTH_TOKEN, DB credentials) in a secrets manager and inject at runtime rather than committing `.env` files.
- Enable TLS at the ingress (the provided compose has an nginx container, adapt certs for production or place behind a load balancer).
- Configure backups for MongoDB and persistent volumes for Redis if self-hosted.
- Monitor logs and health endpoints; add alerting for failed health checks.

Kubernetes (brief)

- Build and push the image defined by the `Dockerfile` to a registry.
- Create `Deployment` and `Service` manifests, map environment variables from `Secrets`/`ConfigMap`, and mount persistent volumes for uploads if needed.
- Wire MongoDB and Redis as external services or StatefulSets depending on scale; use `HorizontalPodAutoscaler` and readiness/liveness probes pointing to `/api/v1/health`.