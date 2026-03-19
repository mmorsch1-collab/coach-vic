# WHOOP OAuth Setup Guide

Complete guide to getting WHOOP API credentials for Coach Vic.

## Prerequisites

- WHOOP membership (active subscription)
- WHOOP account credentials
- 10-15 minutes

## Step 1: Create Developer Account

1. Visit: https://developer.whoop.com/
2. Click **"Sign Up"** or **"Sign In"** (top-right corner)
3. Log in with your WHOOP account credentials
4. Accept the Developer Terms of Service

## Step 2: Create an Application

1. After signing in, go to **"Applications"** (left sidebar)
2. Click **"Create New Application"** button
3. Fill in the application form:

### Application Details

**Application Name:**
```
Coach Vic Personal
```

**Description:**
```
Personal AI health coach that monitors WHOOP data for proactive coaching insights
```

**Application Type:**
```
Personal Use
```

**Redirect URI:**
```
http://127.0.0.1:3000/auth/whoop/callback
```

⚠️ **Important:** The redirect URI must be EXACTLY `http://127.0.0.1:3000/auth/whoop/callback`
- Use `127.0.0.1`, not `localhost`
- Port must be `3000` (or match your Bridge API PORT in `.env`)
- Path must be `/auth/whoop/callback`

### Scopes (Permissions)

Select all **"Read"** permissions:
- ✅ `read:recovery`
- ✅ `read:sleep`
- ✅ `read:workout`
- ✅ `read:cycles`
- ✅ `read:profile`

**Do NOT select write permissions** (not needed for Coach Vic)

### Privacy Policy & Terms

If required, you can use:
```
Privacy Policy URL: https://your-github-repo/PRIVACY.md
Terms of Service URL: https://your-github-repo/TERMS.md
```

(Or leave blank if personal use only)

4. Click **"Create Application"**

## Step 3: Get Your Credentials

After creating the application, you'll see:

1. **Client ID** - A long string (e.g., `abc123def456...`)
2. **Client Secret** - A longer secret string (e.g., `xyz789abc123...`)

⚠️ **IMPORTANT:** Copy these NOW and store them securely. The Client Secret may not be shown again.

## Step 4: Add to Bridge API Configuration

Open your Bridge API `.env` file:

```bash
cd bridge-api
nano .env  # or use your preferred editor
```

Add these lines:

```env
# WHOOP OAuth
WHOOP_CLIENT_ID=your_client_id_here
WHOOP_CLIENT_SECRET=your_client_secret_here
WHOOP_REDIRECT_URI=http://127.0.0.1:3000/auth/whoop/callback
```

**Replace:**
- `your_client_id_here` with your actual Client ID
- `your_client_secret_here` with your actual Client Secret

## Step 5: Test the Connection

### Start Bridge API

```bash
cd bridge-api
npm run dev
```

You should see:
```
Bridge API started on http://127.0.0.1:3000
```

### Initiate OAuth Flow

Open your browser to:
```
http://127.0.0.1:3000/auth/whoop/start
```

**What happens:**
1. Browser redirects to WHOOP login
2. You log in with your WHOOP credentials
3. WHOOP asks you to authorize the app
4. Click **"Authorize"**
5. Browser redirects back to `http://127.0.0.1:3000/auth/whoop/callback`
6. You see a success page

### Verify Tokens Saved

```bash
cd bridge-api
cat tokens.json
```

You should see something like:
```json
{
  "whoop": {
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "expires_at": 1234567890,
    "scope": "read:recovery read:sleep read:workout read:cycles read:profile"
  }
}
```

### Test Data Access

```bash
curl http://127.0.0.1:3000/whoop/today
```

You should get JSON with your recovery data:
```json
{
  "success": true,
  "data": {
    "date": "2026-03-18",
    "recovery": {
      "score": 75,
      "hrv": 60,
      "restingHeartRate": 54,
      ...
    }
  }
}
```

## Troubleshooting

### "Invalid redirect URI" error

**Problem:** Redirect URI doesn't match

**Solution:**
1. Check your Bridge API `.env` PORT matches the redirect URI port
2. Verify WHOOP Developer Portal redirect URI is EXACTLY:
   ```
   http://127.0.0.1:3000/auth/whoop/callback
   ```
3. Use `127.0.0.1`, not `localhost`

### "Invalid client credentials" error

**Problem:** Client ID or Secret is wrong

**Solution:**
1. Go back to WHOOP Developer Portal
2. Verify Client ID and Secret
3. Copy them again (might have trailing spaces)
4. Update `.env` file

### "Access denied" error

**Problem:** You denied authorization or scopes are wrong

**Solution:**
1. Visit http://127.0.0.1:3000/auth/whoop/start again
2. Click "Authorize" this time
3. Verify all read scopes are selected in Developer Portal

### "Token expired" error

**Problem:** Access token expired

**Solution:**
- This is normal! Tokens expire.
- Bridge API auto-refreshes tokens
- Just make another request and it should work

### "No data returned" from /whoop/today

**Problem:** WHOOP data not yet available

**Solution:**
- WHOOP updates data throughout the day
- Recovery data usually available by 7-8 AM
- Sleep data available after waking up
- Try again later or check `/auth/whoop/status`

## Security Notes

- ✅ Client Secret is sensitive - never commit to git
- ✅ `tokens.json` is sensitive - never commit to git
- ✅ Tokens are stored locally only
- ✅ Bridge API only accessible from localhost
- ✅ WHOOP cannot access your machine (only you can access WHOOP)

## Rate Limits

WHOOP API rate limits (as of 2026):
- 100 requests per hour per user
- Coach Vic typically uses 10-20 requests/day
- Well within limits

## Next Steps

1. ✅ WHOOP OAuth complete
2. Continue with other integrations:
   - [Withings Setup](WITHINGS_OAUTH_SETUP.md) (optional)
   - [Strava Setup](STRAVA_OAUTH_SETUP.md) (optional)
   - [Google Setup](GOOGLE_OAUTH_SETUP.md) (optional)
3. Configure [Telegram Bot](TELEGRAM_SETUP.md) (required)
4. Return to [main setup guide](../../SETUP.md)

---

**Having issues?** See [Troubleshooting Guide](../TROUBLESHOOTING.md) or open a GitHub issue.
