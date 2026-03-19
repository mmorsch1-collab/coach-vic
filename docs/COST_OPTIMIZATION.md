# Cost Optimization Guide

Running Coach Vic 24/7 can cost **$0.15-15/day** depending on your configuration. Here's how to optimize based on real-world experience.

## TL;DR - Quick Wins

✅ **Use Haiku, not Sonnet/Opus** → 80-90% cost savings
✅ **Heartbeat every 1-2 hours, not 30 min** → 50-75% savings
✅ **Enable prompt caching** → 40% savings on repeated context
✅ **Set quiet hours (9 PM - 6 AM)** → 27% reduction
✅ **Text over images** → 10x cost difference

**Result: $0.50-1/day instead of $10-15/day**

---

## Real-World Cost Experience

### The Journey: $10/day → $1/day

**Original config:**
- Model: Claude Sonnet 4
- Heartbeat: Every 30 minutes
- No caching
- Cost: **~$10/day**

**Optimized config:**
- Model: Claude Haiku 4.5 (primary), Sonnet 4.5 (fallback)
- Heartbeat: Every 1 hour (later disabled for conversational-only)
- Prompt caching enabled
- Quiet hours: 9 PM - 6 AM
- Cost: **~$1-2/day**

**Savings: 80-90%**

**Key insight:** Haiku's pattern recognition is perfect for heartbeat jobs and data synthesis. You don't need Sonnet for "Is recovery green + strain low?"

---

## Model Selection (Biggest Impact)

### The Reality Check

| Model | Input Cost | Use Case | Daily Cost (Heartbeats) |
|-------|-----------|----------|------------------------|
| Opus 4.6 | $15/MTok | Unnecessary | $12-15/day |
| Sonnet 4.5 | $3/MTok | Overkill | $3-5/day |
| Haiku 4.5 | $0.25/MTok | **Perfect** ⭐ | $1-2/day |

### Recommended Configuration

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-haiku-4-5",
        "fallbacks": ["anthropic/claude-sonnet-4-5"]
      }
    }
  }
}
```

### Why Haiku Works

**Heartbeat jobs are pattern matching:**
- "Is recovery > 67 AND strain < 5 AND time > 2 PM?" ← Haiku excels at this
- "Summarize WHOOP data + calendar + give recommendation" ← Haiku is great
- "Draft a morning briefing with recovery + trend data" ← Haiku handles it

**When to use Sonnet:**
- Multi-week training program design
- Deep trend analysis ("Why is my HRV dropping?")
- Complex reasoning about training periodization
- You want to splurge on deeper insights

**Haiku vs Sonnet quality:**
- For most coaching tasks: 95% as good
- For complex planning: 70-80% as good
- Cost difference: 12x cheaper

---

## Heartbeat Frequency

### Default Config
```json
{
  "heartbeat": {
    "every": "30m"
  }
}
```

**Cost:** 48 API calls/day × $0.02 = ~$0.96/day (Haiku)

### Optimized Configs

#### Option A: Hourly (Recommended ⭐)
```json
{
  "heartbeat": {
    "every": "1h"
  }
}
```
**Cost:** ~$0.50/day
**Savings:** 50%
**Trade-off:** Still catches most coachable moments

#### Option B: Every 2 Hours
```json
{
  "heartbeat": {
    "every": "2h"
  }
}
```
**Cost:** ~$0.25/day
**Savings:** 75%
**Trade-off:** May miss some afternoon nudge opportunities

#### Option C: Strategic Times Only
```json
{
  "heartbeat": {
    "every": "0"  // Disable default
  }
}
```

Then use cron jobs for specific times:
- 10:30 AM (mid-morning check)
- 2:30 PM (afternoon slump check)
- 8:30 PM (recovery prep check)

**Cost:** ~$0.10/day
**Savings:** 90%
**Trade-off:** Less responsive, but catches key moments

#### Option D: Conversational Only
```json
{
  "heartbeat": {
    "every": "0"
  }
}
```

No proactive messages. Coach Vic only responds when you message it.

**Cost:** ~$0.05-0.15/day (conversation-dependent)
**Savings:** 95%
**Trade-off:** No proactive coaching, you drive all interactions

---

## Quiet Hours (Easy Win)

Add to `HEARTBEAT.md`:

```markdown
## Quiet Hours
- **9 PM - 6 AM:** Always return HEARTBEAT_OK (no API calls)
- Don't check WHOOP when user is asleep
```

**Savings:** 9 hours × 2 checks/hour × $0.02 = **$0.36/day (27% reduction)**

**Implementation:**
```markdown
# HEARTBEAT.md

1. Check current time
2. If between 9 PM - 6 AM → return HEARTBEAT_OK
3. Otherwise, proceed with WHOOP check
```

---

## Prompt Caching (40% Savings)

Enable Anthropic's prompt caching for static context:

```json
{
  "agents": {
    "defaults": {
      "models": {
        "anthropic/claude-haiku-4-5": {
          "params": {
            "cacheRetention": "short"  // 5-minute cache
          }
        }
      }
    }
  }
}
```

### How It Works

**First heartbeat call:**
- Reads `SOUL.md`, `HEARTBEAT.md`, `USER.md`, etc.
- Full cost

**Subsequent calls within 5 minutes:**
- Cached workspace files
- 90% discount on cached content
- Only pay for new data (WHOOP response, etc.)

**Savings:** ~40% on repeated context (workspace files, protocols)

---

## Context Pruning

Prevent context bloat:

```json
{
  "agents": {
    "defaults": {
      "contextPruning": {
        "mode": "cache-ttl",
        "ttl": "1h"  // Shorter = cheaper
      }
    }
  }
}
```

**Trade-off:** AI forgets older conversation context faster, but heartbeat jobs don't need long-term memory anyway.

---

## Text Over Images (10x Cost Difference)

**Problem:** Sending food photos for nutrition tracking

**Cost comparison:**
- Image processing: ~$0.02-0.05 per image
- Text description: ~$0.002-0.005 per message

**Savings:** 10x cheaper to say "Chicken burrito bowl with rice, beans, veggies" vs sending photo

**Implementation:**
```markdown
# MESSAGE_COMPOSITION_STANDARDS.md

When user shares meals:
- Encourage text descriptions over photos
- "Quick - what did you have?" vs "Send me a photo"
- Reserve image analysis for complex meals where text is hard
```

---

## Metadata Verification = Quality Over Quantity

**The Problem:** Coaching on stale WHOOP data wastes money AND erodes trust

**The Solution:**
```markdown
# HEARTBEAT.md

1. **ALWAYS CHECK METADATA FIRST**
2. Fetch data from /whoop/today
3. Verify `recovery.metadata.updated_at` is recent (<2 hours)
4. If stale → skip coaching, return HEARTBEAT_OK
5. If fresh → proceed with coaching logic
```

**Why it saves money:**
- Prevents unnecessary coaching messages on old data
- High bar for messaging = fewer API calls
- Default is silence, not noise

**Real example:**
- Before: 48 heartbeats/day, 20 messages sent
- After: 24 heartbeats/day, 3-5 messages sent (only when fresh data + coachable moment)
- Savings: 50% heartbeat reduction + 75% message reduction

---

## Message Composition Filter

**The Insight:** Internal analysis doesn't need to be in the message

**Before (wasteful):**
```
Let me calculate your protein:
- Chicken: 35-40g
- Beans: 5-8g
Total: ~45-50g protein

Good meal choice!
```

**After (efficient):**
```
Good meal choice - the chicken and beans give you solid protein (~45-50g) plus carbs from the rice.
```

**Why it matters:**
- Shorter messages = fewer tokens
- Claude still does the analysis (in reasoning/thinking)
- User gets polished coaching, not visible working

**Savings:** ~30% token reduction on messages

---

## Cost Comparison Table

| Configuration | Daily Cost | Monthly Cost | Notes |
|--------------|------------|--------------|-------|
| Opus + 30min heartbeat | $12-15 | $360-450 | Unnecessary |
| Sonnet + 30min heartbeat | $3-5 | $90-150 | Overkill |
| Haiku + 30min heartbeat | $1-2 | $30-60 | Default |
| **Haiku + 1hr heartbeat** ⭐ | **$0.50-1** | **$15-30** | **Recommended** |
| Haiku + 2hr heartbeat | $0.25-0.50 | $7.50-15 | Budget-friendly |
| Haiku + 3x daily cron | $0.10-0.30 | $3-9 | Minimal |
| Haiku + conversational only | $0.05-0.15 | $1.50-4.50 | Ultra-minimal |
| **Haiku + quiet hours + caching** ⭐ | **$0.40-0.80** | **$12-24** | **Optimized** |

---

## Recommended Setup for Most Users

**Model:** Haiku 4.5 (primary), Sonnet 4.5 (fallback)
**Heartbeat:** 1 hour OR conversational-only
**Quiet hours:** 9 PM - 6 AM
**Prompt caching:** Enabled (5-minute retention)
**Context TTL:** 1 hour
**Metadata verification:** Mandatory (<2 hour freshness)
**Message filter:** Hide internal analysis

**Expected cost:** $0.40-0.80/day ($12-24/month)

---

## When to Splurge on Sonnet

- Building multi-week training programs
- Deep trend analysis ("Why is my HRV dropping every Monday?")
- Testing new coaching protocols
- You have the budget and want max quality

### Hybrid Approach

**Use Haiku by default, Sonnet on demand:**

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-haiku-4-5"
      }
    }
  }
}
```

Then override when you want deeper reasoning:
```
You (in Telegram): Switch to Sonnet
Coach Vic: Switched to Sonnet for this conversation.
You: Analyze my HRV trends over the last 2 weeks
[deeper analysis happens]
You: Switch back to Haiku
```

**Cost:** Mostly Haiku ($1/day), occasional Sonnet splurges ($0.50/conversation)

---

## Testing Your Costs

### Track Actual Usage

1. **Anthropic Dashboard:**
   - Visit https://console.anthropic.com/
   - Check usage tab
   - Monitor daily spend

2. **OpenClaw Logs:**
   ```bash
   openclaw logs tail | grep "tokens"
   ```

3. **Calculate Daily Average:**
   - Week 1: Note daily costs
   - Average them
   - Adjust configuration if too high

### If Costs Are Higher Than Expected

1. **Check heartbeat frequency:**
   ```bash
   openclaw config show | grep heartbeat
   ```

2. **Look for runaway loops:**
   ```bash
   openclaw logs tail -n 100
   ```

3. **Verify prompt caching is enabled:**
   ```json
   "cacheRetention": "short"  // Should be present
   ```

4. **Check message frequency:**
   - Are you getting too many proactive messages?
   - Raise the bar in `HEARTBEAT.md`

---

## The Bottom Line

**Most expensive mistake:**
Running Opus on 30-minute heartbeats = **$15/day** ($450/month)

**Recommended setup:**
Haiku + 1-hour heartbeats + quiet hours = **$0.50/day** ($15/month)

**Ultra-minimal:**
Haiku + conversational-only = **$0.10/day** ($3/month)

**The AI is smart enough on Haiku. Save your money.**

---

## Real-World Testimonial

> "Switched from Sonnet ($10/day) to Haiku ($1-2/day). 80-90% cost savings with no noticeable quality loss for heartbeat jobs and data synthesis. Haiku's pattern recognition is perfect for 'Is recovery green + strain low?' checks. I only use Sonnet now when I want deep multi-week trend analysis."

The data doesn't lie: Haiku works.
