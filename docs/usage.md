# Event Registration Service Usage Guide

This service manages events, activities, participants, QR-code check-in, attendance reporting, and admin key management.

## What You Need

- Node.js dependencies installed with `npm install`.
- MongoDB available through `MONGO_URI`.
- Redis available through `REDIS_URL` or `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD`.
- `AUTH_CLAIMS_HMAC_SECRET` configured so signed auth claims can be verified.
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