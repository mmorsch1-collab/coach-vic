# Coach Vic Setup Guide

Complete step-by-step installation instructions.

## Prerequisites

Before starting, ensure you have:

- ✅ Node.js 20+ installed (`node --version`)
- ✅ npm or pnpm installed
- ✅ Git installed
- ✅ CLI comfort (terminal, environment variables)
- ✅ 1-2 hours of time
- ✅ Always-on machine (laptop, VPS, Raspberry Pi)

## Setup Overview

1. Clone repository
2. Install dependencies
3. Get OAuth credentials (5 accounts)
4. Configure environment variables
5. Run OAuth flows
6. Configure OpenClaw
7. Start services
8. Test

**Estimated time:** 1-2 hours for core setup

---

## Step 1: Clone and Install

```bash
# Clone the repository
git clone https://github.com/mmorsch1-collab/coach-vic.git
cd coach-vic

# Install root dependencies (setup scripts)
npm install

# Install Bridge API dependencies
cd bridge-api
npm install
cd ..
```

---

## Step 2: Get OAuth Credentials

You need to create developer accounts and get credentials for each service you want to integrate.

### Required (Core Setup):

#### 1. WHOOP Developer Account
**Time:** 10-15 minutes

See [WHOOP OAuth Setup Guide](docs/oauth/WHOOP_OAUTH_SETUP.md)

You'll get:
- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`

#### 2. Anthropic API Key
**Time:** 5 minutes

1. Visit https://console.anthropic.com/
2. Sign up or log in
3. Go to API Keys
4. Create a new key
5. Copy the key (starts with `sk-ant-`)

You'll get:
- `ANTHROPIC_API_KEY`

#### 3. Telegram Bot
**Time:** 5 minutes

See [Telegram Setup Guide](docs/oauth/TELEGRAM_SETUP.md)

You'll get:
- `TELEGRAM_BOT_TOKEN`

### Optional Integrations:

#### 4. Withings Developer Account (Optional)
**Time:** 15-20 minutes

See [Withings OAuth Setup Guide](docs/oauth/WITHINGS_OAUTH_SETUP.md)

You'll get:
- `WITHINGS_CLIENT_ID`
- `WITHINGS_CLIENT_SECRET`

#### 5. Strava API (Optional)
**Time:** 10 minutes

See [Strava OAuth Setup Guide](docs/oauth/STRAVA_OAUTH_SETUP.md)

You'll get:
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`

#### 6. Google Cloud Project (Optional)
**Time:** 20-30 minutes

See [Google OAuth Setup Guide](docs/oauth/GOOGLE_OAUTH_SETUP.md)

You'll get:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

**APIs to enable:**
- Google Calendar API (for scheduling)
- Google Sheets API (for database)

---

## Step 3: Configure Environment Variables

### Bridge API Configuration

```bash
# Copy example env file
cd bridge-api
cp .env.example .env

# Edit the file
nano .env  # or use your preferred editor
```

**Minimal .env (WHOOP only):**
```env
# Server Configuration
PORT=3000
NODE_ENV=development
HOST=127.0.0.1
LOG_LEVEL=info

# WHOOP OAuth
WHOOP_CLIENT_ID=your_whoop_client_id_here
WHOOP_CLIENT_SECRET=your_whoop_client_secret_here
WHOOP_REDIRECT_URI=http://127.0.0.1:3000/auth/whoop/callback

# Token Storage
TOKEN_STORAGE_PATH=./tokens.json
```

**Full .env (All Integrations):**
```env
# Server Configuration
PORT=3000
NODE_ENV=development
HOST=127.0.0.1
LOG_LEVEL=info

# WHOOP OAuth
WHOOP_CLIENT_ID=your_whoop_client_id
WHOOP_CLIENT_SECRET=your_whoop_client_secret
WHOOP_REDIRECT_URI=http://127.0.0.1:3000/auth/whoop/callback

# Withings OAuth (optional)
WITHINGS_CLIENT_ID=your_withings_client_id
WITHINGS_CLIENT_SECRET=your_withings_client_secret
WITHINGS_REDIRECT_URI=http://127.0.0.1:3000/auth/withings/callback

# Strava OAuth (optional)
STRAVA_CLIENT_ID=your_strava_client_id
STRAVA_CLIENT_SECRET=your_strava_client_secret
STRAVA_REDIRECT_URI=http://127.0.0.1:3000/auth/strava/callback

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://127.0.0.1:3000/auth/google/callback

# Sheets Configuration (optional)
SPREADSHEET_ID=your_google_spreadsheet_id

# Token Storage
TOKEN_STORAGE_PATH=./tokens.json
```

---

## Step 4: Configure OpenClaw

```bash
# Install OpenClaw globally
npm install -g openclaw@latest

# Run onboarding wizard
openclaw onboard
```

**During onboarding:**
1. Choose Anthropic as your AI provider
2. Enter your `ANTHROPIC_API_KEY`
3. Select Telegram as your channel
4. Enter your `TELEGRAM_BOT_TOKEN`
5. Set model to `claude-haiku-4-5` (cost-effective)
6. Complete workspace setup

**Copy workspace files:**
```bash
# Copy Coach Vic workspace configuration
cp -r openclaw-workspace/* ~/.openclaw/workspace/
```

**Edit workspace files to personalize:**
- `~/.openclaw/workspace/USER.md` - Update with your name, timezone
- `~/.openclaw/workspace/IDENTITY.md` - Customize coach personality
- `~/.openclaw/workspace/TOOLS.md` - Verify Bridge API URL

---

## Step 5: Run OAuth Flows

Each service needs OAuth authorization (one-time setup).

### Start Bridge API

```bash
cd bridge-api
npm run dev
```

Keep this running in a terminal.

### Authorize Each Service

Open a new terminal and run:

```bash
# WHOOP (required)
open http://127.0.0.1:3000/auth/whoop/start

# Withings (optional)
open http://127.0.0.1:3000/auth/withings/start

# Strava (optional)
open http://127.0.0.1:3000/auth/strava/start

# Google (optional)
open http://127.0.0.1:3000/auth/google/start
```

For each:
1. Browser will open
2. Sign in to the service
3. Grant permissions
4. You'll be redirected back to "Success!" page

**Verify tokens saved:**
```bash
cd bridge-api
cat tokens.json
```

You should see tokens for each service you authorized.

---

## Step 6: Test Services

### Test Bridge API

```bash
# Health check
curl http://127.0.0.1:3000/health

# Check WHOOP auth status
curl http://127.0.0.1:3000/auth/whoop/status

# Get today's WHOOP data
curl http://127.0.0.1:3000/whoop/today
```

### Test OpenClaw

```bash
# Start OpenClaw gateway
openclaw gateway --port 18789 --verbose
```

Keep this running.

### Test Telegram Bot

Open Telegram and message your bot:
```
Hello Coach Vic
```

You should get a response.

---

## Step 7: Start Everything (Production)

### Option A: PM2 (Recommended for 24/7)

```bash
# Install PM2
npm install -g pm2

# Start Bridge API
cd bridge-api
pm2 start ecosystem.config.cjs

# Start OpenClaw gateway
pm2 start openclaw gateway --name "openclaw-gateway" -- --port 18789

# Save PM2 config
pm2 save

# Set PM2 to start on boot
pm2 startup
```

### Option B: Manual Start (Development)

**Terminal 1:**
```bash
cd bridge-api
npm run dev
```

**Terminal 2:**
```bash
openclaw gateway --port 18789 --verbose
```

---

## Step 8: Configure Heartbeat Jobs (Optional)

By default, heartbeat is disabled. To enable proactive monitoring:

Edit `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "heartbeat": {
        "every": "1h"  // Check every hour
      }
    }
  }
}
```

**Recommended frequencies:**
- `"30m"` - Every 30 minutes (default, ~$2/day)
- `"1h"` - Every hour (~$1/day)
- `"2h"` - Every 2 hours (~$0.50/day)
- `"0"` - Disabled (conversational only, ~$0.10/day)

See [Cost Optimization Guide](docs/COST_OPTIMIZATION.md) for details.

---

## Step 9: Optional - Google Sheets Setup

If you're using Google Sheets for tracking:

1. Create a Google Spreadsheet
2. Copy the spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
   ```
3. Add to `bridge-api/.env`:
   ```env
   SPREADSHEET_ID=your_spreadsheet_id_here
   ```
4. Set up sheets structure:

See [Google Sheets Setup Guide](docs/SHEETS_SETUP.md) for template.

---

## Verification Checklist

- [ ] Bridge API running on http://127.0.0.1:3000
- [ ] `/health` endpoint returns OK
- [ ] WHOOP OAuth completed (`/auth/whoop/status` returns authenticated)
- [ ] tokens.json contains WHOOP tokens
- [ ] OpenClaw gateway running
- [ ] Telegram bot responds to messages
- [ ] (Optional) Withings/Strava/Google OAuth completed
- [ ] Heartbeat configured (or disabled)

---

## Next Steps

1. **Read the coaching files** - Understand how Coach Vic works
   - `~/.openclaw/workspace/HEARTBEAT.md` - Monitoring logic
   - `~/.openclaw/workspace/SOUL.md` - Coaching philosophy
   - `~/.openclaw/workspace/TOOLS.md` - Available APIs

2. **Customize your coach** - Edit workspace files to match your goals

3. **Optimize costs** - See [Cost Optimization Guide](docs/COST_OPTIMIZATION.md)

4. **Set up 24/7 running** - Use PM2 or systemd

---

## Troubleshooting

See [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for common issues.

**Quick fixes:**

- **Port already in use:** Change `PORT` in `.env`
- **OAuth errors:** Check client ID/secret are correct
- **OpenClaw not connecting:** Verify Telegram bot token
- **No WHOOP data:** Check `/auth/whoop/status`, re-authorize if needed

---

## Need Help?

- **Documentation:** See `/docs` folder
- **Issues:** [GitHub Issues](https://github.com/mmorsch1-collab/coach-vic/issues)
- **Claude Code:** Run `claude` and say "Help me troubleshoot Coach Vic"
