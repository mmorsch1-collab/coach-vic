# Strava OAuth Setup Guide

Complete guide to getting Strava API credentials for workout activity tracking.

## Prerequisites

- Strava account (free or subscription)
- 10-15 minutes

## Step 1: Create API Application

1. Visit: https://www.strava.com/settings/api
2. Log in with your Strava account
3. Scroll to **"My API Application"**

## Step 2: Fill in Application Details

**Application Name:**
```
Coach Vic Personal
```

**Category:**
```
Health & Fitness
```

**Club:**
```
(Leave blank)
```

**Website:**
```
https://github.com/mmorsch1-collab/coach-vic
```

**Application Description:**
```
Personal AI health coach that monitors workout activities for training insights and recovery recommendations.
```

**Authorization Callback Domain:**
```
127.0.0.1
```

⚠️ **Important:** Use just the domain `127.0.0.1` without `http://` or port

4. Upload an icon (optional - can use 💪 emoji screenshot)
5. Click **"Create"**

## Step 3: Get Your Credentials

After creating the application, you'll see:

**Your Application Credentials:**
- **Client ID** - A number (e.g., `123456`)
- **Client Secret** - A hex string (e.g., `abc123def456...`)

⚠️ **IMPORTANT:** Copy both NOW and store them securely.

## Step 4: Add to Bridge API Configuration

Open your Bridge API `.env` file:

```bash
cd bridge-api
nano .env
```

Add these lines:

```env
# Strava OAuth
STRAVA_CLIENT_ID=your_client_id_here
STRAVA_CLIENT_SECRET=your_client_secret_here
STRAVA_REDIRECT_URI=http://127.0.0.1:3000/auth/strava/callback
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

### Initiate OAuth Flow

Open your browser to:
```
http://127.0.0.1:3000/auth/strava/start
```

**What happens:**
1. Browser redirects to Strava authorization page
2. Strava shows what permissions the app is requesting
3. Click **"Authorize"**
4. Browser redirects back to success page

### Verify Tokens Saved

```bash
cd bridge-api
cat tokens.json
```

You should see:
```json
{
  "strava": {
    "access_token": "...",
    "refresh_token": "...",
    "expires_at": 1234567890,
    "athlete_id": 12345678
  }
}
```

### Test Data Access

```bash
curl http://127.0.0.1:3000/strava/latest
```

You should get JSON with your latest activity:
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
    "averageHeartrate": 145,
    "maxHeartrate": 168
  }
}
```

## Permissions Granted

When you authorize, Strava grants these scopes:
- `activity:read` - Read your activities
- `profile:read_all` - Read your profile

**Note:** Coach Vic does NOT need write permissions. It only reads your workout data.

## Troubleshooting

### "Invalid redirect URI" error

**Problem:** Callback domain doesn't match

**Solution:**
1. Go back to https://www.strava.com/settings/api
2. Verify "Authorization Callback Domain" is exactly: `127.0.0.1`
3. No `http://`, no port, no path - just the domain

### "Invalid client credentials" error

**Problem:** Client ID or Secret is wrong

**Solution:**
1. Go to https://www.strava.com/settings/api
2. Verify Client ID and Secret
3. Copy them again carefully
4. Update `.env` file

### "No activities found"

**Problem:** No recent Strava activities

**Solution:**
- Record a workout with Strava app
- Wait a few minutes for data to sync
- Try the API call again

### Rate limit errors

**Problem:** Too many API requests

**Solution:**
- Strava has rate limits: 100 requests/15min, 1000 requests/day
- Coach Vic uses 2-5 requests/day
- If you hit limits, wait 15 minutes

## Strava Data Available

**Activity Data:**
- Activity type (Run, Ride, Swim, etc.)
- Distance
- Duration (moving time, elapsed time)
- Pace/Speed
- Elevation gain
- Heart rate (average, max)
- Calories
- GPS data (if recorded)

**Profile Data:**
- Athlete name
- Profile photo
- Measurements (weight, if set)

## Strava API Limits

**Rate Limits:**
- 100 requests per 15 minutes
- 1,000 requests per day

**Coach Vic Usage:**
- Typically 2-5 requests/day
- Well within limits

## Security Notes

- ✅ Client Secret is sensitive - never commit to git
- ✅ `tokens.json` is sensitive - never commit to git
- ✅ Tokens stored locally only
- ✅ Bridge API only accessible from localhost
- ✅ Read-only access - Coach Vic cannot post activities

## Privacy

**What Coach Vic can see:**
- Your activities (workouts you've recorded)
- Basic profile information

**What Coach Vic CANNOT see:**
- Private activities (unless you authorize them)
- Other people's data
- Your password

**What Coach Vic CANNOT do:**
- Post activities on your behalf
- Modify your activities
- Follow/unfollow people

## Next Steps

1. ✅ Strava OAuth complete
2. Continue with other integrations:
   - [Google Setup](GOOGLE_OAUTH_SETUP.md) (optional)
3. Return to [main setup guide](../../SETUP.md)

---

**Having issues?** Try asking Claude Code: "Help me troubleshoot Strava OAuth"
