# Telegram Bot Setup Guide

Create a Telegram bot for Coach Vic in 5 minutes.

## Step 1: Find BotFather

1. Open Telegram app (mobile or desktop)
2. Search for **@BotFather** (official Telegram bot)
3. Start a chat with BotFather

## Step 2: Create Your Bot

In the chat with BotFather:

```
You: /newbot

BotFather: Alright, a new bot. How are we going to call it?
           Please choose a name for your bot.

You: Coach Vic

BotFather: Good. Now let's choose a username for your bot.
           It must end in `bot`. Like this, for example: TetrisBot or tetris_bot.

You: CoachVicPersonalBot
```

(Choose any username ending in `bot` - it must be unique on Telegram)

**BotFather will respond with:**
```
Done! Congratulations on your new bot. You will find it at t.me/CoachVicPersonalBot

Here is your token:
1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

Keep your token secure and store it safely, it can be used by anyone to control your bot.
```

⚠️ **Copy the token NOW** - You'll need it for configuration.

## Step 3: Configure the Bot (Optional)

You can customize your bot with BotFather commands:

### Set Description
```
/setdescription
[Select your bot]
Personal AI health coach powered by WHOOP data
```

### Set About Text
```
/setabouttext
[Select your bot]
Coach Vic monitors your health data and provides proactive coaching insights.
```

### Set Profile Picture
```
/setuserpic
[Select your bot]
[Upload an image - e.g., 💪 emoji screenshot]
```

### Set Commands (Optional)
```
/setcommands
[Select your bot]

Then paste:
start - Start conversation with Coach Vic
help - Get help with commands
status - Check system status
today - Get today's health briefing
workout - Request a workout plan
```

## Step 4: Get Your Chat ID

You need your Telegram chat ID for OpenClaw configuration.

### Option A: Send a Test Message

1. Find your bot: t.me/YourBotUsername
2. Click **"Start"**
3. Send any message (e.g., "Hello")

Then visit (in browser):
```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
```

Replace `<YOUR_BOT_TOKEN>` with your actual token.

You'll see JSON with your chat ID:
```json
{
  "ok": true,
  "result": [{
    "update_id": 123,
    "message": {
      "message_id": 1,
      "from": {
        "id": 123456789,  // ← This is your chat ID
        "first_name": "Your Name"
      }
    }
  }]
}
```

### Option B: Use a Bot

1. Search for **@userinfobot** on Telegram
2. Start a chat
3. Send `/start`
4. It will reply with your chat ID

## Step 5: Configure OpenClaw

### During Onboarding

When you run `openclaw onboard`, you'll be asked:

```
Which channels would you like to use?
> Telegram

Enter your Telegram Bot Token:
> 1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
```

### Manual Configuration

Edit `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz",
      "dmPolicy": "pairing",
      "streamMode": "off"
    }
  }
}
```

### Pair Your Chat

After starting OpenClaw gateway:

```bash
openclaw gateway --port 18789
```

In Telegram, message your bot:
```
/start
```

OpenClaw will prompt you to confirm pairing.

## Step 6: Test the Bot

### Start a Conversation

Message your bot:
```
Hello Coach Vic
```

You should get a response from Coach Vic.

### Test a Command

```
What's my recovery today?
```

Coach Vic will fetch your WHOOP data and respond.

## Troubleshooting

### Bot doesn't respond

**Problem:** OpenClaw gateway not running

**Solution:**
```bash
openclaw gateway --port 18789 --verbose
```

Check logs for errors.

### "Unauthorized" error

**Problem:** Bot token is wrong

**Solution:**
1. Verify token in `~/.openclaw/openclaw.json`
2. Check for trailing spaces or missing characters
3. Get a new token from BotFather if needed:
   ```
   /revoke
   [Select your bot]
   /token
   [Select your bot]
   ```

### Bot responds but Coach Vic doesn't work

**Problem:** Bridge API not running or not configured

**Solution:**
1. Start Bridge API:
   ```bash
   cd bridge-api && npm run dev
   ```
2. Verify WHOOP OAuth is complete
3. Test Bridge API directly:
   ```bash
   curl http://127.0.0.1:3000/whoop/today
   ```

### Multiple messages from bot

**Problem:** Multiple OpenClaw instances running

**Solution:**
```bash
# Kill all instances
ps aux | grep openclaw
kill <PID>

# Start fresh
openclaw gateway --port 18789
```

## Security Notes

- ✅ Bot token is sensitive - never commit to git
- ✅ Only you can message your bot (unless you share the link)
- ✅ Use `dmPolicy: "pairing"` to require explicit pairing
- ✅ Don't share your bot token publicly

## Advanced Configuration

### Enable Streaming (Shows Typing)

```json
{
  "channels": {
    "telegram": {
      "streamMode": "on"
    }
  }
}
```

**Trade-off:** More responsive, but shows tool calls in progress

### Group Chat Support

```json
{
  "channels": {
    "telegram": {
      "groupPolicy": "allowlist",
      "groups": {
        "allowlist": ["-100123456789"]
      }
    }
  }
}
```

(Get group ID from `getUpdates` like chat ID)

## Next Steps

1. ✅ Telegram bot created and paired
2. Test conversation with Coach Vic
3. Return to [main setup guide](../../SETUP.md)

---

**Need help?** See [Troubleshooting Guide](../TROUBLESHOOTING.md) or open a GitHub issue.
