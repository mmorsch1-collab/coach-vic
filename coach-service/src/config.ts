import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/config.ts → dist/config.js, so the package root is one level above dist/.
const packageRoot = path.resolve(__dirname, '..');

const schema = z.object({
  anthropicApiKey: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  modelPrimary: z.string().default('claude-haiku-4-5'),
  modelHeavy: z.string().default('claude-sonnet-5-5'),

  telegramBotToken: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  telegramChatId: z.string().min(1, 'TELEGRAM_CHAT_ID is required'),

  bridgeUrl: z.string().url().default('http://127.0.0.1:3000'),

  tz: z.string().default('America/New_York'),
  // Daily workout start time (HH:MM, local). Drives the morning ritual's calendar
  // block AND the morning cron schedule (briefing/fallback/missed-workout shift
  // with it). Change here to move the whole workout rhythm — e.g. 05:30 vs 09:30.
  workoutTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'WORKOUT_TIME must be HH:MM (24h)')
    .default('05:30'),
  proactiveEnabled: z
    .string()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),
  // Master switch for the M–F morning ritual (builds/rebuilds the day's sheet +
  // calendar block + briefing) and its coupled missed-workout check. Set false to
  // stop it clobbering manually-built sheets or an in-progress workout.
  morningRitualEnabled: z
    .string()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),
  quietHoursStart: z.coerce.number().int().min(0).max(23).default(21),
  quietHoursEnd: z.coerce.number().int().min(0).max(23).default(6),
  maxProactivePerDay: z.coerce.number().int().positive().default(5),
  nudgeCooldownMinutes: z.coerce.number().int().nonnegative().default(180),

  workspaceDir: z.string().default(path.join(packageRoot, 'workspace')),
  stateDir: z.string().default(path.join(packageRoot, '.state')),
  retrievalMode: z.enum(['keyword', 'semantic']).default('keyword'),

  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

function load() {
  try {
    return schema.parse({
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      modelPrimary: process.env.COACH_MODEL_PRIMARY,
      modelHeavy: process.env.COACH_MODEL_HEAVY,
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
      telegramChatId: process.env.TELEGRAM_CHAT_ID,
      bridgeUrl: process.env.BRIDGE_URL,
      tz: process.env.TZ,
      workoutTime: process.env.WORKOUT_TIME,
      proactiveEnabled: process.env.PROACTIVE_ENABLED,
      morningRitualEnabled: process.env.MORNING_RITUAL_ENABLED,
      quietHoursStart: process.env.QUIET_HOURS_START,
      quietHoursEnd: process.env.QUIET_HOURS_END,
      maxProactivePerDay: process.env.MAX_PROACTIVE_PER_DAY,
      nudgeCooldownMinutes: process.env.NUDGE_COOLDOWN_MINUTES,
      workspaceDir: process.env.WORKSPACE_DIR,
      stateDir: process.env.STATE_DIR,
      retrievalMode: process.env.RETRIEVAL_MODE,
      logLevel: process.env.LOG_LEVEL,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error('Coach-service configuration invalid:');
      for (const e of err.errors) console.error(`  - ${e.path.join('.')}: ${e.message}`);
    }
    throw new Error('Invalid configuration — see errors above and your .env');
  }
}

export const config = load();
export type Config = z.infer<typeof schema>;
