# Withings OAuth Setup Guide

Complete guide to getting Withings API credentials for body composition tracking.

## Prerequisites

- Withings account (Body Scan, Body+, or other connected scale)
- 15-20 minutes

## Step 1: Create Developer Account

1. Visit: https://developer.withings.com/
2. Click **"Sign up"** or **"Sign in"** (top-right corner)
3. Log in with your Withings account credentials
4. Accept the Developer Terms of Service

## Step 2: Create an Application

1. After signing in, go to **"My Applications"**
2. Click **"Create an Application"**
3. Fill in the application form:

### Application Details

**Application Name:**
```
Coach Vic Personal
```

**Description:**
```
Personal AI health coach that monitors body composition data for health insights
```

**Company Name:**
```
Personal Use
```

**Contact Email:**
```
your-email@example.com
```

**Website (optional):**
```
https://github.com/mmorsch1-collab/coach-vic
```

**Callback URI:**
```
http://127.0.0.1:3000/auth/withings/callback
```

⚠️ **Important:** The callback URI must be EXACTLY `http://127.0.0.1:3000/auth/withings/callback`
- Use `127.0.0.1`, not `localhost`
- Port must be `3000` (or match your Bridge API PORT)
- Path must be `/auth/withings/callback`

### Application Type

Select: **Personal Application**

4. Click **"Register Application"**

## Step 3: Wait for Approval (Important!)

⚠️ **Withings requires manual approval for API access**

**Timeline:**
- Sandbox access: Immediate
- Production access: 24-48 hours (sometimes longer)

**What happens:**
1. You'll get sandbox credentials immediately
2. Withings team reviews your application
3. You'll receive an email when approved for production

**During testing:**
- Sandbox access works with your own account only
- Production access needed for long-term use

## Step 4: Get Your Credentials

After approval (or immediately for sandbox):

1. Go to **"My Applications"**
2. Click on your application name
3. You'll see:
   - **Client ID** - A string of numbers (e.g., `1234567890abc`)
   - **Consumer Secret** - A longer secret string

⚠️ **IMPORTANT:** Copy these NOW and store them securely.

## Step 5: Add to Bridge API Configuration

Open your Bridge API `.env` file:

```bash
cd bridge-api
nano .env
```

Add these lines:

```env
# Withings OAuth
WITHINGS_CLIENT_ID=your_client_id_here
WITHINGS_CLIENT_SECRET=your_consumer_secret_here
WITHINGS_REDIRECT_URI=http://127.0.0.1:3000/auth/withings/callback
```

**Replace:**
- `your_client_id_here` with your actual Client ID
- `your_consumer_secret_here` with your actual Consumer Secret

## Step 6: Test the Connection

### Start Bridge API

```bash
cd bridge-api
npm run dev
```

### Initiate OAuth Flow

Open your browser to:
```
http://127.0.0.1:3000/auth/withings/start
```

**What happens:**
1. Browser redirects to Withings login
2. You log in with your Withings credentials
3. Withings asks you to authorize the app
4. Click **"Allow"** or **"Authorize"**
5. Browser redirects back to success page

### Verify Tokens Saved

```bash
cd bridge-api
cat tokens.json
```

You should see:
```json
{
  "withings": {
    "access_token": "...",
    "refresh_token": "...",
    "expires_at": 1234567890,
    "user_id": "12345678"
  }
}
```

### Test Data Access

```bash
curl http://127.0.0.1:3000/withings/latest
```

You should get JSON with your body composition:
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

## Troubleshooting

### "Application pending approval"

**Problem:** Withings hasn't approved your app yet

**Solution:**
- Wait 24-48 hours for approval email
- Use sandbox mode for testing in the meantime
- Sandbox works with your own account only

### "Invalid redirect URI" error

**Problem:** Redirect URI doesn't match

**Solution:**
1. Check Bridge API `.env` PORT matches redirect URI port
2. Verify Withings Developer Portal callback URI is exactly:
   ```
   http://127.0.0.1:3000/auth/withings/callback
   ```
3. Use `127.0.0.1`, not `localhost`

### "Invalid client credentials" error

**Problem:** Client ID or Secret is wrong

**Solution:**
1. Go back to Withings Developer Portal
2. Verify Client ID and Consumer Secret
3. Copy them again carefully
4. Update `.env` file

### "No measurements found"

**Problem:** No recent weigh-ins

**Solution:**
- Weigh yourself on your Withings scale
- Wait a few minutes for data to sync
- Try the API call again

### Token refresh issues

**Problem:** Access token expired

**Solution:**
- Bridge API should auto-refresh tokens
- If it doesn't work, re-run OAuth flow:
  ```
  http://127.0.0.1:3000/auth/withings/start
  ```

## Withings Data Available

**Body Composition:**
- Weight (kg)
- Body Fat %
- Muscle Mass (kg)
- Bone Mass (kg)
- Body Water %
- Visceral Fat Rating (if supported by your scale)

**Other Metrics (depending on device):**
- Heart Rate
- Blood Pressure
- SpO2
- Temperature

## Rate Limits

Withings API rate limits:
- 120 requests per minute
- Coach Vic uses 2-5 requests/day
- Well within limits

## Security Notes

- ✅ Consumer Secret is sensitive - never commit to git
- ✅ `tokens.json` is sensitive - never commit to git
- ✅ Tokens stored locally only
- ✅ Bridge API only accessible from localhost

## Next Steps

1. ✅ Withings OAuth complete
2. Continue with other integrations:
   - [Strava Setup](STRAVA_OAUTH_SETUP.md) (optional)
   - [Google Setup](GOOGLE_OAUTH_SETUP.md) (optional)
3. Return to [main setup guide](../../SETUP.md)

---

**Having issues?** Try asking Claude Code: "Help me troubleshoot Withings OAuth"
