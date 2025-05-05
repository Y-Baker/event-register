# Event Registration Service

## Resposiablities

- Create and manage events.
- Create and manage activities for events.
- Create and manage participants for events.
- Upload participants from a CSV file.
- Register participants for activities using QR codes.
- Generate QR codes for events.
- Send QR codes to participants via email.
- Scan QR codes to register participants for activities.

## Roles

- Organizer: Can create and manage events, activities, and participants.
- Scanner: Can scan QR codes to register participants for activities.

## Auth

- Set the `x-api-key` header to the API key.
- The API key is required for the endpoint that required a role.

## Quick Start

- `/api/v1/` - Get all the available endpoints.
- `/api/v1/health` - Check the health of the API.
- `/api/v1/health/db` - Check the health of the database.
- `/api/v1/health/redis` - Check the health of the keydb.

## API Endpoints

```json
[
  { 
    "method": "GET",
    "path": "/api/v1/",
    "description": "Welcome to the API"
  },
  {
    "method": "GET",
    "path": "/api/v1/health",
    "description": "Health check for the API"
  },
  {
    "method": "GET",
    "path": "/api/v1/health/db",
    "description": "Health check for the MongoDB connection"
  },
  {
    "method": "GET",
    "path": "/api/v1/health/redis",
    "description": "Health check for the Redis connection"
  },

  {
    "method": "POST",
    "path": "/api/v1/events",
    "description": "Create a new event"
  },
  {
    "method": "GET",
    "path": "/api/v1/events",
    "description": "Get all events"
  },
  {
    "method": "GET",
    "path": "/api/v1/events/:id",
    "description": "Get event by ID"
  },
  {
    "method": "DELETE",
    "path": "/api/v1/events/:id",
    "description": "Delete event by ID"
  },

  {
    "method": "GET",
    "path": "/api/v1/events/:id/activities/",
    "description": "Get all activities for an event"
  },
  {
    "method": "POST",
    "path": "/api/v1/events/:id/activities/",
    "description": "Create a new activity for an event"
  },
  {
    "method": "GET",
    "path": "/api/v1/events/:id/activities/:activityId",
    "description": "Get activity by ID"
  },

  {
    "method": "POST",
    "path": "/api/v1/events/:id/participants/",
    "description": "Add participants to an event"
  },
  {
    "method": "GET",
    "path": "/api/v1/events/:id/participants/",
    "description": "Get all participants for an event"
  },
  {
    "method": "GET",
    "path": "/api/v1/events/:id/participants/:participantId",
    "description": "Get participant by ID"
  },
  {
    "method": "POST",
    "path": "/api/v1/enents/participants/upload/",
    "description": "Upload participants from a CSV file"
  },

  {
    "method": "GET",
    "path": "/api/v1/events/:id/qr/send",
    "description": "Send QR codes to participants via email"
  },
  {
    "method": "POST",
    "path": "/api/v1/events/:id/qr/register-activity",
    "description": "Register a scanned activity for a participant"
  },

  {
    "method": "POST",
    "path": "/api/v1/admin/keys/:KeyName/issue",
    "description": "Issue a new key"
  },
  {
    "method": "GET",
    "path": "/api/v1/admin/keys",
    "description": "Get all keys"
  },
  {
    "method": "GET",
    "path": "/api/v1/admin/keys/:KeyName",
    "description": "Get key by name"
  }
]
```

### Create a new Event

- `POST /api/v1/events` - Create a new event.
- Request Body:

  ```json
  {
    "name": "string",
    "description": "string",
    "date": "2023-10-01T00:00:00Z", // Optional ISO 8601 format
    "location": "string"
  }
  ```

- Response:
  ```json
  {
    "message": "Event created",
    "event": {
      "name": "General Day",
      "description": "IEEE day",
      "date": "2025-05-03T10:19:11.452Z",
      "location": "N/A",
      "participants": [],
      "_id": "6815ed9f95be88312831b299",
      "createdAt": "2025-05-03T10:19:11.456Z",
      "updatedAt": "2025-05-03T10:19:11.456Z",
      "__v": 0
    }
  }
  ```

### Create a new Activity For Event

- `POST /api/v1/events/:eventId/activities` - Create a new activity for an event.
- Request Body:
  ```json
  {
    "name": "Attendance",
    "type": "Check-In"
  }
  ```
- Response:
  ```json
  {
    "message": "Activity created",
    "activity": {
      "eventId": "6815ed9f95be88312831b299",
      "name": "Attendance",
      "type": "Check-In",
      "qrId": "ae855f85-58cd-40cf-b483-33b48dc6661b",
      "_id": "6815ee6395be88312831b29e",
      "createdAt": "2025-05-03T10:22:27.478Z",
      "updatedAt": "2025-05-03T10:22:27.478Z",
      "__v": 0
    }
  }
  ```

### Create a new Participant For Event

- `POST /api/v1/events/:eventId/participants` - Create a new participant for an event.
- Request Body:

  ```json
  {
    "name": "Yousef Ahmed",
    "email": "test@gmail.com",
    "phone": "+20123456789",
    "university": "Menoufia University",
    "faculty": "FEE",
    "major": "CE"
  }
  ```

- Response:
  ```json
  {
    "message": "Participant added",
    "participant": {
      "_id": "6815f0a595be88312831b2a7",
      "name": "Yousef Ahmed",
      "email": "yuossefahmedgaber@gmail.com",
      "phoneNumber": "0123456789",
      "university": "Menoufia",
      "faculty": "FEE",
      "major": "CE",
      "qrSent": false,
      "eventId": "6815ed9f95be88312831b299",
      "scannedActivities": [],
      "createdAt": "2025-05-03T10:32:05.349Z",
      "updatedAt": "2025-05-03T10:32:05.349Z",
      "__v": 0
    }
  }
  ```

### Upload CSV File For Event Participants

- `POST /api/v1/events/:eventId/participants/upload` - Upload a CSV file for event participants.
- Request Body:
  fileName: `file`

- Response:

```json
{
  "message": "Upload complete",
  "total": 900,
  "successful": 898,
  "errors": 2,
  "errorDetails": [
    {
      "participant": {
        "name": "Scott Olsen",
        "email": "mlandry@burke.com",
        "phoneNumber": "0289804952562",
        "university": "Jefferson-Orr",
        "faculty": "relationship",
        "major": "Engineer, energy"
      },
      "error": "Email already registered for this event"
    },
    {
      "participant": {
        "name": "Anthony Bass",
        "email": "aclark@hotmail.com",
        "phoneNumber": "0257947476570",
        "university": "Nelson-Mcneil",
        "faculty": "consider",
        "major": "Solicitor"
      },
      "error": "Email already registered for this event"
    }
  ]
}
```

### Register Activity For Participant

- `POST /api/v1/events/:eventId/qr/register-activity?ticketId=[value]&activityId=[value]` - Register an activity for a participant.
- Response:

```json
  Activity scanned successfully
```
