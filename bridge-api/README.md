# Bridge API

OAuth token management and API bridge service for health data sources.

## Purpose

Bridge API owns all OAuth tokens and provides a clean REST API for accessing health data. OpenClaw calls Bridge API endpoints; Bridge API handles the complexity of OAuth token management and API requests.

## Features

- ✅ OAuth 2.0 flow implementation (WHOOP, Withings, Strava, Google)
- ✅ Automatic token refresh
- ✅ Structured logging (Pino)
- ✅ Input validation (Zod)
- ✅ Error handling middleware
- ✅ TypeScript
- ✅ Localhost-only (127.0.0.1)

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your OAuth credentials
nano .env

# Run in development mode
npm run dev

# Build for production
npm run build

# Run in production mode
npm start
```

## Environment Variables

See `.env.example` for all configuration options.

**Required:**
- `WHOOP_CLIENT_ID` - From WHOOP Developer Portal
- `WHOOP_CLIENT_SECRET` - From WHOOP Developer Portal

**Optional:**
- Withings, Strava, Google OAuth credentials

## API Endpoints

### Health Check
```
GET /health
```

### WHOOP
```
GET /auth/whoop/start          - Initiate OAuth flow
GET /auth/whoop/callback       - OAuth callback (automatic)
GET /auth/whoop/status         - Check auth status
POST /auth/whoop/revoke        - Revoke tokens

GET /whoop/today               - Today's WHOOP data
```

### Withings
```
GET /auth/withings/start
GET /withings/latest           - Latest body composition
GET /withings/weight-history   - Historical weight data
```

### Strava
```
GET /auth/strava/start
GET /strava/latest             - Latest workout activity
```

### Google Calendar
```
GET /auth/google/start
GET /calendar/today            - Today's calendar events
POST /calendar/events          - Create calendar event
```

### Google Sheets (Coaching Database)
```
GET /coaching/goals            - Get goals from Sheets
POST /coaching/goals           - Add goal to Sheets
POST /coaching/whoop-snapshot  - Save WHOOP data to Sheets
GET /coaching/whoop-history    - Get WHOOP history from Sheets
```

See [API Documentation](../docs/API.md) for complete endpoint reference.

## Development

```bash
# Run with hot reload
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint code
npm run lint

# Format code
npm run format

# Check formatting
npm run format:check
```

## Security

- Binds to `127.0.0.1` only (localhost)
- Tokens stored in `tokens.json` (gitignored)
- All secrets in `.env` (gitignored)
- No external network access required

## Token Storage

Tokens are stored in `tokens.json`:

```json
{
  "whoop": {
    "access_token": "...",
    "refresh_token": "...",
    "expires_at": 1234567890
  }
}
```

**Never commit this file to git.**

## Automatic Token Refresh

Bridge API automatically refreshes expired access tokens using refresh tokens. You don't need to manually re-authorize unless:

- Refresh token expires (rare)
- User revokes access
- OAuth app credentials change

## Troubleshooting

### Port already in use
```bash
# Change PORT in .env
PORT=3001
```

### OAuth errors
- Verify client ID/secret in .env
- Check redirect URI matches exactly
- Ensure OAuth app is approved (for production)

### "Cannot find module" errors
```bash
npm install
```

## Production Deployment

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Build
npm run build

# Start with PM2
pm2 start npm --name "bridge-api" -- start

# Save PM2 config
pm2 save

# Auto-start on boot
pm2 startup
```

### Using systemd

See `examples/systemd/bridge-api.service` for systemd unit file.

## Architecture

```
┌─────────────────┐
│  Health APIs    │
│  (WHOOP, etc.)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Bridge API    │
│  (This Service) │
│                 │
│  • OAuth Mgmt   │
│  • Token Store  │
│  • API Proxy    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    OpenClaw     │
│  (AI Agent)     │
└─────────────────┘
```

## License

MIT

## Author

**Matthew Morsch**
[LinkedIn](https://www.linkedin.com/in/matthewmorsch)
