# Cutover — single-bot swap with instant revert

Two processes can't long-poll the same bot token at once, so we **pre-validate hard, then flip**,
keeping OpenClaw intact-but-stopped for instant rollback.

## 0. Prereqs
- Bridge API hardened, running, and re-authenticated (see `../bridge-api/CUTOVER.md`).
- `coach-service/.env` filled in. For pre-validation, set `TELEGRAM_BOT_TOKEN` to a **throwaway
  test bot** (create via @BotFather) and message that bot from your account.

## 1. Pre-validate (no conflict with the live bot)
```
npm install && npm run build
npm run ritual -- --force         # builds a real workout sheet + 5:30 event; prints the briefing
npm run chat -- "what should I do today?"
npm run chat -- "had 5 eggs and grilled chicken for lunch"
npm test
```
Then run it live on the **test bot** for a bit: `pm2 start ecosystem.config.cjs --name coach-vic-test`
and chat it. Confirm: chat quality, memory recall, a real morning ritual, restart recovery
(`pm2 restart coach-vic-test` and verify the queue/schedule resume).

## 2. Swap to the real bot
```
pm2 stop openclaw-gateway          # frees the real bot token (do NOT delete it)
# set TELEGRAM_BOT_TOKEN in .env to the REAL Coach Vic bot token, then:
pm2 delete coach-vic-test 2>$null
pm2 start ecosystem.config.cjs     # name: coach-vic, on the real token
pm2 save
```
Coach Vic now answers from the new service. Experience unchanged.

## 3. Revert (kept ready)
```
pm2 stop coach-vic
pm2 start openclaw-gateway
```
OpenClaw is left installed and configured — rollback is seconds.

## 4. Decommission (only when you're satisfied)
```
pm2 delete openclaw-gateway
# remove the OpenClaw cron jobs + the daily security-audit job; archive ~/.openclaw
```
