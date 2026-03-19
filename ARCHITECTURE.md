# Coach Vic Architecture

## System Overview

Coach Vic is a multi-component system that combines health APIs, a data bridge, AI agent platform, and messaging to deliver proactive health coaching.

```
┌──────────────────────────────────────────────────────────────┐
│                     Health Data Sources                       │
│                                                                │
│  ┌────────┐  ┌─────────┐  ┌────────┐  ┌──────────────┐      │
│  │ WHOOP  │  │Withings │  │ Strava │  │Google Calendar│      │
│  └───┬────┘  └────┬────┘  └───┬────┘  └──────┬───────┘      │
└──────┼───────────┼────────────┼───────────────┼──────────────┘
       │           │            │               │
       │           │            │               │
       └───────────┴────────────┴───────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │     Bridge API        │
              │  (OAuth + Data Layer) │
              │                       │
              │  • Token Management   │
              │  • API Requests       │
              │  • Data Transformation│
              │  • localhost:3000     │
              └──────────┬────────────┘
                         │
                         ▼
              ┌───────────────────────┐
              │      OpenClaw         │
              │   (AI Agent Platform) │
              │                       │
              │  • Heartbeat Jobs     │
              │  • Workspace Memory   │
              │  • Context Management │
              │  • Claude Integration │
              └──────────┬────────────┘
                         │
                         ▼
              ┌───────────────────────┐
              │   Anthropic Claude    │
              │                       │
              │  • Haiku 4.5 (primary)│
              │  • Sonnet 4.5 (fallback)│
              └──────────┬────────────┘
                         │
                         ▼
              ┌───────────────────────┐
              │    Telegram Bot       │
              │                       │
              │  • Message Delivery   │
              │  • User Interaction   │
              └───────────────────────┘
```

## Components

### 1. Bridge API

**Technology:** Node.js, TypeScript, Express

**Purpose:**
- Own all OAuth tokens (never shared with OpenClaw)
- Provide clean REST API for data access
- Handle token refresh automatically
- Transform API responses into coaching-friendly format

**Key Features:**
- Runs on `localhost:3000` (loopback only, secure)
- Stateless (tokens stored in `tokens.json`)
- Auto token refresh
- Structured logging (Pino)
- Input validation (Zod)

**Endpoints:**
```
Health:
  GET /health

WHOOP:
  GET /auth/whoop/start
  GET /auth/whoop/callback
  GET /auth/whoop/status
  GET /whoop/today

Withings:
  GET /auth/withings/start
  GET /withings/latest
  GET /withings/weight-history

Strava:
  GET /auth/strava/start
  GET /strava/latest

Google:
  GET /auth/google/start
  GET /calendar/today
  POST /calendar/events
  GET /coaching/goals
  POST /coaching/whoop-snapshot
```

### 2. OpenClaw

**Technology:** Node.js AI agent platform

**Purpose:**
- Run the AI agent (Coach Vic personality)
- Execute heartbeat jobs (periodic health checks)
- Manage conversation context and memory
- Handle Telegram integration

**Key Features:**
- Workspace-based configuration (markdown files)
- Heartbeat system (configurable frequency)
- Context pruning and caching
- Multi-channel support (Telegram primary)
- Session memory across restarts

**Workspace Files:**
```
~/.openclaw/workspace/
├── IDENTITY.md       # Coach personality
├── SOUL.md           # Coaching philosophy
├── HEARTBEAT.md      # Monitoring logic
├── TOOLS.md          # Bridge API endpoints
├── USER.md           # User profile
├── MEMORY.md         # Long-term memory
└── WORKOUT_PROTOCOL.md  # Workout creation rules
```

### 3. Claude (Anthropic)

**Models:**
- **Primary:** `claude-haiku-4-5` - Fast, cost-effective for pattern recognition
- **Fallback:** `claude-sonnet-4-5` - Deeper reasoning when needed

**Usage:**
- Heartbeat jobs: Haiku (simple data checks)
- Conversational coaching: Haiku (data synthesis)
- Complex planning: Sonnet (workout programs, trend analysis)

**Cost Optimization:**
- Prompt caching (5-min retention)
- Context pruning (1-hour TTL)
- Haiku-first strategy (10x cheaper than Opus)

### 4. Health APIs

#### WHOOP API
**Data:** Recovery, HRV, sleep, strain, skin temperature

**Key Endpoints:**
- `/v1/cycle` - Daily recovery data
- `/v1/sleep` - Sleep performance
- `/v1/recovery` - Recovery score + metrics

**Metadata Verification:**
Always check `recovery.metadata.updated_at` timestamp. If >2 hours old, data is stale.

#### Withings API
**Data:** Weight, body fat %, muscle mass, bone mass, hydration

**Key Endpoints:**
- `/measure` - Body composition measurements
- `/v2/measure` - Historical data

#### Strava API
**Data:** Activities, heart rate, pace, distance

**Key Endpoints:**
- `/athlete/activities` - Recent workouts
- `/activities/{id}` - Activity details

#### Google APIs
**Calendar API:** Event scheduling, availability
**Sheets API:** Database for goals, tasks, WHOOP history, workout tracking

## Data Flow

### Heartbeat Job Flow

```
1. OpenClaw triggers heartbeat (every N minutes/hours)
   │
   ├─→ Read HEARTBEAT.md (coaching logic)
   │
   ├─→ Fetch http://127.0.0.1:3000/whoop/today
   │   └─→ Bridge API fetches WHOOP API
   │       └─→ Returns recovery, HRV, sleep, strain
   │
   ├─→ Check metadata.updated_at (freshness)
   │   └─→ If stale (>2h): return HEARTBEAT_OK
   │
   ├─→ Apply coaching logic:
   │   • Green recovery + low strain → nudge to move
   │   • Red recovery + high strain → warn to ease up
   │   • Otherwise → stay quiet
   │
   └─→ If coachable moment:
       └─→ Send message via Telegram
```

### Conversational Flow

```
1. User sends message to Telegram bot
   │
   ├─→ OpenClaw receives message
   │
   ├─→ Reads workspace files (SOUL.md, USER.md, TOOLS.md)
   │
   ├─→ Fetches fresh data from Bridge API:
   │   ├─→ GET /whoop/today
   │   ├─→ GET /withings/latest
   │   └─→ GET /calendar/today
   │
   ├─→ Sends to Claude with context:
   │   • User message
   │   • Workspace context
   │   • Fresh health data
   │   • Recent conversation history
   │
   ├─→ Claude generates response (coaching)
   │
   └─→ OpenClaw sends via Telegram
```

### Workout Creation Flow

```
1. User: "Build me a workout"
   │
   ├─→ OpenClaw reads WORKOUT_PROTOCOL.md
   │
   ├─→ Fetches data in parallel:
   │   ├─→ GET /withings/latest (body composition)
   │   ├─→ GET /whoop/today (recovery state)
   │   └─→ GET /coaching/whoop-history (recent patterns)
   │
   ├─→ Analyzes:
   │   • Recovery state (green/yellow/red)
   │   • Body comp trend
   │   • Last workout date/type
   │
   ├─→ Builds workout:
   │   • Exercise selection
   │   • Sets/reps based on recovery
   │   • Progressive overload from history
   │
   ├─→ Creates Google Sheet:
   │   • POST /coaching/sheets/Workout_YYYY-MM-DD/append
   │
   └─→ Sends Telegram message with sheet link
```

## Security Model

### OAuth Token Storage

**Bridge API owns all tokens:**
```
bridge-api/tokens.json:
{
  "whoop": {
    "access_token": "...",
    "refresh_token": "...",
    "expires_at": 1234567890
  },
  "withings": { ... },
  "google": { ... }
}
```

**OpenClaw never sees tokens:**
- Only calls Bridge API endpoints
- Bridge API handles token refresh
- Tokens never leave localhost

### Network Security

- Bridge API binds to `127.0.0.1` only
- No external access to Bridge API
- OpenClaw → Bridge API: local HTTP
- OpenClaw → Claude: HTTPS (API key in env)
- OpenClaw → Telegram: HTTPS (bot token in config)

### Data Privacy

- All data processing happens locally
- No data sent to third parties (except OpenAI/Anthropic for AI)
- Health data never logged or persisted (except in Google Sheets if configured)
- Telegram messages ephemeral (not stored)

## Configuration

### Environment Variables

**Bridge API (.env):**
```env
PORT=3000
HOST=127.0.0.1
WHOOP_CLIENT_ID=...
WHOOP_CLIENT_SECRET=...
WITHINGS_CLIENT_ID=...
ANTHROPIC_API_KEY=...
```

**OpenClaw (openclaw.json):**
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-haiku-4-5"
      },
      "heartbeat": {
        "every": "1h"
      }
    }
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "..."
    }
  }
}
```

## Deployment

### Development

```bash
# Terminal 1: Bridge API
cd bridge-api && npm run dev

# Terminal 2: OpenClaw
openclaw gateway --port 18789 --verbose
```

### Production (PM2)

```bash
# Start Bridge API
cd bridge-api
pm2 start ecosystem.config.cjs

# Start OpenClaw
pm2 start openclaw -- gateway --port 18789

# Save config
pm2 save

# Auto-start on boot
pm2 startup
```

### Production (Systemd)

See `examples/systemd/` for service files.

## Monitoring

### Bridge API Logs

```bash
# Development
npm run dev  # Pretty-printed logs

# Production
tail -f logs/bridge-api.log
```

### OpenClaw Logs

```bash
# Real-time
openclaw gateway --verbose

# Historical
openclaw logs tail
```

### Health Checks

```bash
# Bridge API health
curl http://127.0.0.1:3000/health

# OAuth status
curl http://127.0.0.1:3000/auth/whoop/status

# OpenClaw status
openclaw status
```

## Cost Considerations

### API Costs

**Anthropic Claude:**
- Haiku 4.5: ~$0.25 per 1M input tokens
- Sonnet 4.5: ~$3.00 per 1M input tokens

**Typical Usage:**
- Heartbeat (1h frequency): ~24 calls/day × 2K tokens = ~$0.50/day
- Conversations: Variable, ~10-20 calls/day × 4K tokens = ~$0.20/day
- Total: **$0.70-1.00/day** with Haiku

**Optimization:**
- Use Haiku for heartbeats (pattern matching)
- Use Sonnet sparingly (complex reasoning)
- Enable prompt caching (40% savings)
- Reduce heartbeat frequency (1h → 2h = 50% savings)

See [Cost Optimization Guide](docs/COST_OPTIMIZATION.md) for details.

## Scalability

**Current Design:**
- Single user
- Local-only Bridge API
- One Telegram bot

**Future Considerations:**
- Multi-user: Separate token storage per user
- Remote Bridge API: Add authentication layer
- Database: Replace JSON with PostgreSQL
- Multiple channels: Discord, Slack, etc.

This architecture prioritizes simplicity and security for personal use.
