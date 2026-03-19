# Troubleshooting Guide

Common issues and solutions for Coach Vic setup.

---

## Bridge API Issues

### Port Already in Use

**Error:** `EADDRINUSE: address already in use :::3000`

**Solution:**
```bash
# Option 1: Change port in .env
cd bridge-api
nano .env
# Change: PORT=3001

# Option 2: Kill process using port 3000
# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Mac/Linux:
lsof -ti:3000 | xargs kill -9
```

### Bridge API Won't Start

**Error:** `Cannot find module` or `MODULE_NOT_FOUND`

**Solution:**
```bash
cd bridge-api
rm -rf node_modules
npm install
npm run dev
```

### "Invalid .env file" errors

**Problem:** Environment variables not loading

**Solution:**
1. Verify `.env` file exists in `bridge-api/` directory
2. Check for typos in variable names
3. No spaces around `=` signs
4. No quotes around values (unless value contains spaces)

**Correct:**
```env
WHOOP_CLIENT_ID=abc123
```

**Incorrect:**
```env
WHOOP_CLIENT_ID = "abc123"
```

---

## OAuth Issues

### WHOOP: "Invalid redirect URI"

**Problem:** Redirect URI mismatch

**Solution:**
1. WHOOP Developer Portal redirect must be: `http://127.0.0.1:3000/auth/whoop/callback`
2. Bridge API `.env` must match: `WHOOP_REDIRECT_URI=http://127.0.0.1:3000/auth/whoop/callback`
3. Use `127.0.0.1`, NOT `localhost`
4. Port must match `PORT` in `.env`

### WHOOP: "Invalid client credentials"

**Problem:** Wrong Client ID or Secret

**Solution:**
1. Go to https://developer.whoop.com/
2. Find your application
3. Copy Client ID and Secret again carefully
4. Update `.env` file
5. Restart Bridge API

### Google: "This app isn't verified"

**Problem:** Google security warning

**Solution:**
- This is NORMAL for personal apps
- Click **"Advanced"**
- Click **"Go to Coach Vic (unsafe)"** - It's safe, it's YOUR app
- Click **"Allow"**

This warning appears because the app isn't verified by Google. For personal use, this is fine.

### Google: "Access blocked: Authorization Error"

**Problem:** You're not added as a test user

**Solution:**
1. Go to https://console.cloud.google.com/
2. APIs & Services → OAuth consent screen
3. Scroll to "Test users"
4. Click **"Add Users"**
5. Add your Gmail address
6. Save
7. Try OAuth flow again

### Token Expired Errors

**Problem:** `TOKEN_EXPIRED` or `401 Unauthorized`

**Solution:**
- Bridge API should auto-refresh tokens
- If it doesn't work, re-run OAuth flow:
  ```
  http://127.0.0.1:3000/auth/SERVICE_NAME/start
  ```
  Replace `SERVICE_NAME` with: `whoop`, `withings`, `strava`, or `google`

---

## OpenClaw Issues

### OpenClaw Won't Install

**Error:** `npm install -g openclaw@latest` fails

**Solution:**
```bash
# Try with sudo (Mac/Linux)
sudo npm install -g openclaw@latest

# Or use specific package manager
pnpm add -g openclaw@latest
```

### Telegram Bot Not Responding

**Problem:** Bot doesn't reply to messages

**Checklist:**
1. Is OpenClaw gateway running?
   ```bash
   openclaw status
   ```
2. Is Bridge API running?
   ```bash
   curl http://127.0.0.1:3000/health
   ```
3. Is bot token correct in `~/.openclaw/openclaw.json`?
4. Did you pair the bot?
   - Message bot: `/start`
   - Confirm pairing

**Debug:**
```bash
# Start with verbose logging
openclaw gateway --port 18789 --verbose
```

### "HEARTBEAT_OK" - No Proactive Messages

**Problem:** Coach Vic never reaches out

**Possible Reasons:**
1. Heartbeat is disabled (`"every": "0"`)
   - Check: `~/.openclaw/openclaw.json`
   - Change to: `"every": "1h"`

2. Quiet hours active
   - Check: `~/.openclaw/workspace/HEARTBEAT.md`

3. No coachable moments detected
   - This is normal! Coach Vic only messages when data warrants it
   - Not every check results in a message

4. WHOOP data is stale
   - Coach Vic checks `metadata.updated_at`
   - If >2 hours old, skips messaging

**Test heartbeat manually:**
```bash
# In OpenClaw gateway logs, look for heartbeat executions
openclaw logs tail
```

### Workspace Files Not Loading

**Problem:** Coach Vic doesn't remember context

**Solution:**
1. Verify workspace files exist:
   ```bash
   ls ~/.openclaw/workspace/
   ```
2. Copy example files:
   ```bash
   cp -r openclaw-workspace/* ~/.openclaw/workspace/
   ```
3. Restart OpenClaw gateway

---

## Data Issues

### No WHOOP Data Returned

**Problem:** `/whoop/today` returns empty or errors

**Possible Reasons:**
1. **Not authenticated**
   - Check: `curl http://127.0.0.1:3000/auth/whoop/status`
   - If not authenticated, run OAuth: `http://127.0.0.1:3000/auth/whoop/start`

2. **Data not yet available**
   - WHOOP updates recovery data throughout the morning
   - Sleep data available after waking
   - Try again later

3. **No WHOOP membership**
   - Coach Vic requires active WHOOP subscription

**Debug:**
```bash
# Check auth status
curl http://127.0.0.1:3000/auth/whoop/status

# Check tokens exist
cat bridge-api/tokens.json | grep whoop

# Try fetching data
curl http://127.0.0.1:3000/whoop/today
```

### No Calendar Events

**Problem:** `/calendar/today` returns empty

**Possible Reasons:**
1. No events on calendar today
2. Wrong calendar being accessed
3. OAuth scopes insufficient

**Solution:**
1. Add a test event to your Google Calendar
2. Verify OAuth scopes include calendar access
3. Try again

---

## Cost Issues

### Anthropic API Costs Too High

**Problem:** Spending $5-10/day on Claude

**Solutions:**

1. **Switch to Haiku** (80-90% savings)
   - Edit: `~/.openclaw/openclaw.json`
   - Change: `"primary": "anthropic/claude-haiku-4-5"`

2. **Reduce heartbeat frequency**
   - Change: `"every": "2h"` instead of `"30m"`
   - 75% reduction in API calls

3. **Enable prompt caching**
   - Add to models config:
     ```json
     "cacheRetention": "short"
     ```

4. **Set quiet hours**
   - Edit: `~/.openclaw/workspace/HEARTBEAT.md`
   - Add: Return HEARTBEAT_OK between 9 PM - 6 AM

See [Cost Optimization Guide](COST_OPTIMIZATION.md) for details.

---

## General Debugging

### Check All Services Running

```bash
# Bridge API
curl http://127.0.0.1:3000/health

# OpenClaw
openclaw status

# Test Telegram
# Message your bot: "Hello"
```

### Check Logs

**Bridge API logs:**
```bash
cd bridge-api
# If using npm run dev, logs show in terminal
# If using PM2:
pm2 logs bridge-api
```

**OpenClaw logs:**
```bash
openclaw logs tail

# Or verbose mode:
openclaw gateway --port 18789 --verbose
```

### Environment Check

```bash
# Check Node version (need 20+)
node --version

# Check npm version
npm --version

# Check OpenClaw version
openclaw --version
```

---

## Still Stuck?

1. **Use Claude Code:**
   ```bash
   claude
   ```
   Then say: "Help me troubleshoot Coach Vic [describe your issue]"

2. **Check GitHub Issues:**
   https://github.com/mmorsch1-collab/coach-vic/issues

3. **Create New Issue:**
   Include:
   - What you tried
   - Error messages
   - Node version
   - OS (Windows/Mac/Linux)

---

## Quick Fixes Checklist

Before asking for help, try these:

- [ ] Restart Bridge API: `cd bridge-api && npm run dev`
- [ ] Restart OpenClaw: `openclaw gateway --port 18789`
- [ ] Check `.env` file has all required values
- [ ] Verify tokens.json exists and has your OAuth tokens
- [ ] Re-run OAuth flows if tokens seem wrong
- [ ] Check Bridge API health: `curl http://127.0.0.1:3000/health`
- [ ] Check OpenClaw logs: `openclaw logs tail`
- [ ] Verify workspace files exist: `ls ~/.openclaw/workspace/`

Most issues are fixed by restarting services or re-running OAuth flows.
