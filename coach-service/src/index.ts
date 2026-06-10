import { config } from './config.js';
import { logger } from './logger.js';
import { CoachBot } from './telegram/bot.js';
import { DeliveryQueue } from './delivery/queue.js';
import { registerJobs } from './scheduler/jobs.js';
import { bridge } from './bridge/client.js';

/**
 * Coach Vic service entrypoint. Wires the Telegram bot, the retrying delivery
 * queue, and the scheduler — then runs until stopped. Replaces the OpenClaw gateway.
 */
async function main(): Promise<void> {
  logger.info(
    { tz: config.tz, bridge: config.bridgeUrl, proactive: config.proactiveEnabled },
    'Starting Coach Vic service',
  );

  // Best-effort bridge health check (don't crash if it's momentarily down).
  try {
    await bridge.health();
    logger.info('Bridge API reachable');
  } catch (err) {
    logger.warn({ err }, 'Bridge API not reachable at startup — will keep trying on demand');
  }

  const bot = new CoachBot();
  const queue = new DeliveryQueue((text) => bot.sendMessage(text));
  const tasks = registerJobs({ deliver: (text) => queue.enqueue(text) });

  queue.start();
  await bot.start();

  logger.info('Coach Vic service is up.');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    for (const t of tasks) t.stop();
    queue.stop();
    try {
      await bot.stop();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
