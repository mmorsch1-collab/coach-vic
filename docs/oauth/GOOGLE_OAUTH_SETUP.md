# Google OAuth Setup Guide

Complete guide to setting up Google Cloud Project for Calendar and Sheets integration.

## Prerequisites

- Google account
- 20-30 minutes
- Credit card (for Google Cloud verification - free tier, won't be charged)

## Overview

You'll be creating:
- Google Cloud Project
- OAuth 2.0 credentials
- Enabling Calendar API
- Enabling Sheets API

## Step 1: Create Google Cloud Project

1. Visit: https://console.cloud.google.com/
2. Click **"Select a project"** (top bar)
3. Click **"New Project"**
4. Fill in:
   - **Project name:** `Coach Vic Personal`
   - **Organization:** (leave as-is)
5. Click **"Create"**
6. Wait for project to be created (30 seconds)
7. Select your new project from the dropdown

## Step 2: Enable APIs

### Enable Calendar API

1. In left sidebar: **APIs & Services** → **Library**
2. Search for: `Calendar`
3. Click **"Google Calendar API"**
4. Click **"Enable"**
5. Wait for it to enable

### Enable Sheets API

1. Click **Library** again
2. Search for: `Sheets`
3. Click **"Google Sheets API"**
4. Click **"Enable"**

## Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** (unless you have Google Workspace)
3. Click **"Create"**

### App Information

**App name:**
```
Coach Vic
```

**User support email:**
```
your-email@gmail.com
```

**App logo:** (optional - upload 💪 icon if you want)

**Application home page:** (optional)
```
https://github.com/yourusername/coach-vic
```

**Application privacy policy:** (optional)

**Application terms of service:** (optional)

**Authorized domains:** (leave blank for localhost development)

**Developer contact information:**
```
your-email@gmail.com
```

4. Click **"Save and Continue"**

### Scopes

1. Click **"Add or Remove Scopes"**
2. Search and select these scopes:

**Calendar scopes:**
- `.../auth/calendar.readonly` - See your calendars
- `.../auth/calendar.events` - View and edit events

**Sheets scopes:**
- `.../auth/spreadsheets` - See and edit your spreadsheets

3. Click **"Update"**
4. Click **"Save and Continue"**

### Test Users

⚠️ **Important for External apps:**

While your app is in "Testing" mode, only test users can authorize.

1. Click **"Add Users"**
2. Add your email: `your-email@gmail.com`
3. Click **"Add"**
4. Click **"Save and Continue"**

### Summary

1. Review everything
2. Click **"Back to Dashboard"**

## Step 4: Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **"Create Credentials"** → **"OAuth client ID"**
3. Select **"Web application"**

**Name:**
```
Coach Vic Bridge API
```

**Authorized JavaScript origins:** (leave blank)

**Authorized redirect URIs:**
1. Click **"Add URI"**
2. Enter: `http://127.0.0.1:3000/auth/google/callback`

⚠️ **Important:** Must be exactly `http://127.0.0.1:3000/auth/google/callback`

4. Click **"Create"**

### Copy Your Credentials

A popup will show:
- **Client ID** - Looks like `123456789-abc.apps.googleusercontent.com`
- **Client Secret** - Looks like `GOCSPX-abc123def456`

⚠️ **IMPORTANT:** Copy both NOW and store them securely.

5. Click **"OK"**

## Step 5: Add to Bridge API Configuration

Open your Bridge API `.env` file:

```bash
cd bridge-api
nano .env
```

Add these lines:

```env
# Google OAuth
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://127.0.0.1:3000/auth/google/callback
```

**Replace with your actual credentials.**

## Step 6: Test the Connection

### Start Bridge API

```bash
cd bridge-api
npm run dev
```

### Initiate OAuth Flow

Open your browser to:
```
http://127.0.0.1:3000/auth/google/start
```

**What happens:**
1. Redirects to Google sign-in
2. Sign in with your Google account
3. Google shows permissions request:
   - "See your calendars"
   - "View and edit your spreadsheets"
4. Click **"Allow"** or **"Continue"**

⚠️ If you see **"This app isn't verified"**:
1. Click **"Advanced"**
2. Click **"Go to Coach Vic (unsafe)"** - This is safe, it's YOUR app
3. Click **"Allow"**

5. Browser redirects back to success page

### Verify Tokens Saved

```bash
cd bridge-api
cat tokens.json
```

You should see:
```json
{
  "google": {
    "access_token": "ya29...",
    "refresh_token": "1//...",
    "expires_at": 1234567890,
    "scope": "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/spreadsheets"
  }
}
```

### Test Calendar Access

```bash
curl http://127.0.0.1:3000/calendar/today
```

Should return today's events (or empty array if no events).

## Step 7: Create Google Spreadsheet (Optional)

If you want to use Sheets for tracking:

1. Go to: https://sheets.google.com/
2. Create a new spreadsheet
3. Name it: `Coach Vic Data`
4. Copy the spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID_HERE/edit
   ```
5. Add to `.env`:
   ```env
   SPREADSHEET_ID=your_spreadsheet_id_here
   ```

See [Sheets Setup Guide](../SHEETS_SETUP.md) for recommended structure.

## Troubleshooting

### "This app isn't verified" warning

**Problem:** Google shows unverified app warning

**Solution:**
- This is normal for personal apps in testing mode
- Click **"Advanced"** → **"Go to Coach Vic (unsafe)"**
- This is safe - it's YOUR app running on YOUR machine

### "Access blocked: Authorization Error"

**Problem:** You're not listed as a test user

**Solution:**
1. Go to OAuth consent screen
2. Add your email under "Test users"
3. Try OAuth flow again

### "Redirect URI mismatch"

**Problem:** Redirect URI doesn't match

**Solution:**
1. Go to APIs & Services → Credentials
2. Click your OAuth client ID
3. Verify redirect URI is exactly: `http://127.0.0.1:3000/auth/google/callback`
4. Save changes

### "Insufficient permissions" error

**Problem:** Missing required scopes

**Solution:**
1. Go to OAuth consent screen → Scopes
2. Verify calendar and sheets scopes are added
3. Re-run OAuth flow: `http://127.0.0.1:3000/auth/google/start`

### No calendar events returned

**Problem:** No events on calendar

**Solution:**
- Add an event to your Google Calendar
- Make sure you're using the right calendar
- Try again

## Google Cloud Free Tier

**Good news:** Google Cloud APIs are free for personal use at these volumes:
- Calendar API: 1,000,000 requests/day (free)
- Sheets API: 500 requests/100 seconds (free)

**Coach Vic usage:**
- ~10-50 requests/day
- Well within free tier

## Security Notes

- ✅ Client Secret is sensitive - never commit to git
- ✅ `tokens.json` is sensitive - never commit to git
- ✅ Tokens stored locally only
- ✅ Bridge API only accessible from localhost
- ✅ Limited scopes (read calendar, edit sheets only)

## Publishing Your App (Optional)

If you want to skip the "unverified app" warning:

1. Go to OAuth consent screen
2. Click **"Publish App"**
3. Submit for verification (takes 1-2 weeks)

**Not necessary for personal use.**

## Next Steps

1. ✅ Google OAuth complete
2. (Optional) Set up Google Sheets structure: [Sheets Setup Guide](../SHEETS_SETUP.md)
3. Return to [main setup guide](../../SETUP.md)

---

**Having issues?** Try asking Claude Code: "Help me troubleshoot Google OAuth setup"
