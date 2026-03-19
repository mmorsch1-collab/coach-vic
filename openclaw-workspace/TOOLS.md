# TOOLS.md - Bridge API Reference

## Base URL

`http://127.0.0.1:3000` (localhost only)

Your primary data source for coaching. The Bridge API provides access to health data via OAuth.

---

## WHOOP Data

### GET /whoop/today

Today's WHOOP recovery, sleep, and strain data.

**Response:**
```json
{
  "success": true,
  "data": {
    "date": "2026-03-18",
    "recovery": {
      "score": 71,
      "hrv": 60,
      "restingHeartRate": 54,
      "spo2": 97,
      "skinTemp": 95.5,
      "metadata": {
        "updated_at": "2026-03-18T07:32:00Z"
      }
    },
    "sleep": {
      "durationHours": 7.5,
      "sleepScore": 85,
      "inBedHours": 8.0
    },
    "strain": {
      "score": 8.2
    }
  }
}
```

**CRITICAL:** Always check `recovery.metadata.updated_at`
- If >2 hours old → data is stale, skip coaching
- If fresh → proceed with coaching logic

---

## Withings Data (Optional)

### GET /withings/latest

Latest body composition measurement.

**Response:**
```json
{
  "success": true,
  "data": {
    "weight": 152.5,
    "bodyFat": 11.8,
    "muscleMass": 127.5,
    "boneMass": 8.2,
    "hydration": 62.1,
    "measureDate": "2026-03-18T06:30:00Z"
  }
}
```

### GET /withings/weight-history

Historical weight data.

**Query params:**
- `days` (optional): Number of days to fetch (default: 30, max: 90)

---

## Strava Data (Optional)

### GET /strava/latest

Latest workout activity.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123456789",
    "name": "Morning Run",
    "type": "Run",
    "startDate": "2026-03-18T06:00:00Z",
    "distance": 5000,
    "movingTime": 1800,
    "elapsedTime": 1920,
    "totalElevationGain": 45,
    "averageHeartrate": 145,
    "maxHeartrate": 168,
    "averageSpeed": 2.78
  }
}
```

---

## Google Calendar (Optional)

### GET /calendar/today

Today's calendar events.

**Response:**
```json
{
  "success": true,
  "data": {
    "date": "2026-03-18",
    "events": [
      {
        "id": "event_123",
        "title": "Team Meeting",
        "startTime": "2026-03-18T10:00:00Z",
        "endTime": "2026-03-18T11:00:00Z",
        "location": "Zoom",
        "attendees": ["team@example.com"],
        "isAllDay": false
      }
    ],
    "summary": {
      "totalEvents": 5,
      "totalMinutes": 240,
      "firstEventTime": "10:00 AM",
      "lastEventTime": "5:00 PM"
    }
  }
}
```

### POST /calendar/events

Create a calendar event.

**Request:**
```json
{
  "title": "Workout",
  "startTime": "2026-03-18T16:00:00Z",
  "endTime": "2026-03-18T17:00:00Z",
  "description": "Coach Vic reminder: Chest day",
  "location": "Gym"
}
```

---

## Google Sheets (Optional)

### POST /coaching/whoop-snapshot

Save daily WHOOP data to Sheets for historical tracking.

**Request:**
```json
{
  "date": "2026-03-18",
  "recovery": 71,
  "hrv": 60,
  "restingHeartRate": 54,
  "sleepHours": 7.5,
  "sleepScore": 85,
  "strain": 8.2
}
```

### GET /coaching/whoop-history

Get historical WHOOP snapshots from Sheets.

**Query params:**
- `days` (optional): Number of days to fetch (default: 7, max: 90)

### GET /coaching/goals

Get goals from Sheets.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "goal_1",
      "name": "Workout 5x/week",
      "target": 5,
      "current": 3,
      "frequency": "weekly",
      "category": "fitness",
      "active": true
    }
  ]
}
```

---

## Authentication Endpoints

### GET /auth/whoop/status

Check if WHOOP OAuth is connected.

**Response:**
```json
{
  "success": true,
  "data": {
    "authenticated": true
  }
}
```

### GET /health

Health check.

**Response:**
```json
{
  "ok": true,
  "timestamp": "2026-03-18T10:30:00.000Z",
  "uptime": 123.456
}
```

---

## Usage Notes

- **Bridge API must be running:** `cd bridge-api && npm run dev`
- **All endpoints return:** `{success: true, data: {...}}` or `{success: false, error: {...}}`
- **Use fetch() or HTTP tools** to call these endpoints
- **Time zone:** Calendar API defaults to America/New_York (configure in Bridge API)

---

## Error Handling

If an endpoint returns `success: false`:

```json
{
  "success": false,
  "error": {
    "message": "Not authenticated with WHOOP",
    "code": "NOT_AUTHENTICATED"
  }
}
```

**Common error codes:**
- `NOT_AUTHENTICATED` - OAuth flow not completed
- `TOKEN_EXPIRED` - Re-run OAuth flow
- `NO_DATA` - No data available for requested date
- `WHOOP_API_ERROR` - WHOOP API is down or rate-limited

---

This is your lifeline to health data. Use it proactively to drive coaching impact.
