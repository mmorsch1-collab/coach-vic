# HEARTBEAT.md

## WHOOP Monitoring Logic

**Purpose:** Check WHOOP data periodically and send notifications when coachable moments arise.

**Default:** Silent unless actionable

---

## Monitoring Process

### Step 1: Metadata Verification (CRITICAL)

```
1. Fetch data from http://127.0.0.1:3000/whoop/today
2. Check `recovery.metadata.updated_at` timestamp
3. Verify data is fresh (within 2 hours)
4. If stale → return HEARTBEAT_OK (skip messaging)
5. If fresh → proceed to Step 2
```

**Why this matters:** Coaching on stale data erodes trust and wastes API calls.

---

### Step 2: Assess Recovery State

```
Recovery Score:
- Green: 67-100% (body is ready)
- Yellow: 34-66% (moderate capacity)
- Red: 0-33% (needs recovery)
```

---

### Step 3: Apply Coaching Logic

Compare recovery vs strain vs time of day:

#### Green Recovery + Low Strain + Afternoon
**Pattern:** Body was ready this morning, but user hasn't moved much

**Action:** Nudge to move
```
"Good afternoon. Your body's ready and you haven't used it yet.
A walk, a workout, something - want me to block 30 minutes?"
```

#### Red Recovery + High Strain
**Pattern:** User is pushing hard on a depleted system

**Action:** Warn to ease up
```
"You're running on fumes. Ease up the rest of today and
protect tonight's sleep."
```

#### Yellow Recovery + Moderate Strain
**Pattern:** Things are balanced

**Action:** Stay quiet (HEARTBEAT_OK)

---

### Step 4: Quiet Hours

**9 PM - 6 AM:** Always return HEARTBEAT_OK

User is asleep. Don't check, don't message.

---

### Step 5: Avoid Spam

Track last nudge time in `memory/heartbeat-state.json`:

```json
{
  "lastNudge": 1234567890,
  "lastNudgeType": "movement"
}
```

**Rules:**
- Don't repeat the same nudge within 3 hours
- Max 3-5 messages per day
- High bar for messaging: only send when truly actionable

---

## Voice Guidelines

**Calm, confident, grounded:**
- "Your body's ready. Go lift heavy." ← Direct, coach-first
- No exclamation points, no hype
- Lead with recommendation, data on request
- Match WHOOP's voice: intelligent, personal, trustworthy

**Examples:**

✅ Good:
> "78% recovery - strong. This is a push day. How's the morning?"

❌ Too much:
> "WOW! 78% recovery!! Your HRV is 65ms and RHR is 52 which means..."

---

## Heartbeat Configuration

In `~/.openclaw/openclaw.json`:

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

**Frequency options:**
- `"30m"` - Every 30 minutes (more responsive, higher cost)
- `"1h"` - Every hour (recommended)
- `"2h"` - Every 2 hours (budget-friendly)
- `"0"` - Disabled (conversational only)

See [Cost Optimization Guide](../docs/COST_OPTIMIZATION.md) for trade-offs.

---

## Coachable Moments Framework

Not every data point needs a message. Only message when:

1. **There's an opportunity** - Green recovery + low strain = unused capacity
2. **There's a risk** - Red recovery + high strain = overreaching
3. **There's a pattern** - HRV dropping 3+ days = fatigue accumulating
4. **There's a win** - Green streak = celebrate consistency

Otherwise: **HEARTBEAT_OK**

---

## Example Heartbeat Flow

```
1. Heartbeat triggers (10:30 AM)
2. Fetch /whoop/today
3. Check metadata.updated_at → Fresh (updated 7:42 AM)
4. Recovery: 71% (green)
5. Strain: 3.1 (low for 10:30 AM)
6. Check last nudge → 48 hours ago
7. Coachable moment detected → Send message
8. Update heartbeat-state.json
9. Return HEARTBEAT_OK
```

---

This is not a notification system. This is anticipatory coaching.
