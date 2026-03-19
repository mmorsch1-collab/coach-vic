# Coach Vic - Open Source AI Health Coach

An AI coach that monitors your WHOOP, Withings, and Strava data and reaches out when you need coaching — not when you ask for it.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)

## What It Does

Coach Vic runs heartbeat jobs to monitor your health data and sends proactive coaching via Telegram when patterns warrant it:

- **Heartbeat monitoring** - Checks WHOOP recovery/strain, Withings body composition, Strava workouts
- **Coachable moments** - Sends notifications based on data patterns (e.g., "green recovery + low strain = go move")
- **Morning briefings** - Recovery data + body composition trends + workout recommendations
- **Google Sheets integration** - Database for goals, tasks, WHOOP history AND workout builder
- **Calendar integration** - Schedules workouts and breaks
- **Science-backed** - HRV-guided training, sleep architecture, autonomic nervous system monitoring

## ⚠️ Important: This Requires Technical Comfort

As OpenClaw's founder said: "If you don't know CLI, maybe OpenClaw isn't for you." Same applies here.

**You'll need:**
- CLI familiarity (npm, git, environment variables)
- Node.js 20+
- 1-2 hours for setup
- Willingness to configure OAuth for multiple services
- Always-on machine (laptop, VPS, Raspberry Pi)

**If any of those are dealbreakers, this might not be for you.**

## Cost to Run

**$0.50-2/day** depending on configuration (optimizable to $0.15/day)

- Uses Claude Haiku 4.5 by default (~$1-2/day)
- Can optimize with less frequent heartbeats
- See [Cost Optimization Guide](docs/COST_OPTIMIZATION.md) for details

## Architecture

```
┌─────────────────┐
│  Health APIs    │
│  (WHOOP, etc.)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────┐
│   Bridge API    │◄─────┤  OpenClaw    │
│  (OAuth + Data) │      │  (AI Agent)  │
└────────┬────────┘      └──────┬───────┘
         │                      │
         │                      ▼
         │              ┌──────────────┐
         └─────────────►│   Telegram   │
                        │     Bot      │
                        └──────────────┘
```

**Components:**
1. **Bridge API** - Node.js/TypeScript REST API for OAuth token management
2. **OpenClaw** - AI agent platform (installable via npm)
3. **Claude** - Haiku 4.5 for pattern recognition, Sonnet 4.5 for complex reasoning
4. **Telegram** - Delivery channel

## Setup

**This project is optimized for Claude Code users.** Claude Code will guide you through setup interactively.

### Recommended: Claude Code Setup
**Time: 45-90 minutes**

```bash
git clone https://github.com/mmorsch1-collab/coach-vic.git
cd coach-vic
claude
```

Then say: **"Help me set up Coach Vic"**

Claude Code will:
- Walk you through getting OAuth credentials for each service
- Help configure your `.env` files
- Guide you through running OAuth flows
- Help debug any issues that come up
- Get you running quickly

### Alternative: Manual Setup
**Time: 1.5-2 hours**

If you prefer to do it manually or don't have Claude Code, follow the detailed step-by-step guide: [SETUP.md](SETUP.md)

## Core Setup vs Optional Integrations

**Core (Minimal):**
- WHOOP API (recovery monitoring)
- Telegram (delivery)
- OpenClaw (AI agent)
- Anthropic API (Claude)

**Optional:**
- Withings (body composition tracking)
- Strava (workout activity data)
- Google Calendar (scheduling)
- Google Sheets (database + workout builder)

Each optional integration adds 15-20 minutes setup time.

## What You Get

- Complete source code (Bridge API + OpenClaw workspace)
- Comprehensive setup guides for manual or Claude Code-assisted setup
- OAuth setup guides for each service
- Cost optimization guide (how to run for $0.50/day vs $15/day)
- Google Sheets templates
- Troubleshooting documentation

## Documentation

- [Setup Guide](SETUP.md) - Complete installation instructions
- [Architecture](ARCHITECTURE.md) - How the system works
- [Cost Optimization](docs/COST_OPTIMIZATION.md) - How to minimize API costs
- [OAuth Setup Guides](docs/oauth/) - Step-by-step for each service
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions
- [API Documentation](docs/API.md) - Bridge API endpoints

## Project Structure

```
coach-vic/
├── bridge-api/           # OAuth + data layer
│   ├── src/
│   │   ├── routes/      # API endpoints
│   │   ├── services/    # OAuth services
│   │   └── middleware/  # Error handling, validation
│   └── package.json
├── openclaw-workspace/   # AI agent configuration
│   ├── IDENTITY.md      # Coach personality
│   ├── HEARTBEAT.md     # Monitoring logic
│   ├── SOUL.md          # Coaching philosophy
│   └── TOOLS.md         # API endpoints
├── docs/                 # Documentation
├── scripts/              # Setup automation
└── examples/             # Config templates
```

## Requirements

### Software
- Node.js 20+ (22+ recommended)
- npm, yarn, or pnpm
- Git

### Accounts (Free Tiers Available)
- WHOOP Developer Account
- Anthropic API Key (Claude)
- Telegram (for bot creation)

### Optional Accounts
- Withings Developer Account
- Strava API Access
- Google Cloud Project

### Hardware
- Always-on machine (can be laptop, VPS, Raspberry Pi)
- Minimum 1GB RAM, 2GB disk space

## Security

- Bridge API binds to `127.0.0.1` only (localhost)
- OAuth tokens stored locally in `tokens.json`
- All secrets in `.env` (never committed)
- No data leaves your machine except API calls

## License

MIT License - See [LICENSE](LICENSE) file

## Contributing

Contributions welcome! Please:
1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

- **Issues:** [GitHub Issues](https://github.com/mmorsch1-collab/coach-vic/issues)
- **Documentation:** See `/docs` folder
- **Discord:** [Join the community](https://discord.gg/yourinvite)

## Acknowledgments

Built with:
- [OpenClaw](https://openclaw.ai) - AI agent platform
- [Anthropic Claude](https://anthropic.com) - Language models
- [WHOOP](https://whoop.com) - Recovery & fitness tracking
- [Withings](https://withings.com) - Body composition
- [Strava](https://strava.com) - Workout data

---

**Made with 💪 by someone who wanted AI coaching that actually works.**
