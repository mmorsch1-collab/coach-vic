import { Bot } from 'grammy';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { handleUserMessage } from './chat.js';

/**
 * Telegram transport (grammY, long-polling — no public webhook). Serves ONLY the
 * configured chat id (single-user). Exposes sendMessage() for the delivery queue
 * and proactive jobs.
 */

const TG_LIMIT = 4000; // under Telegram's 4096 to be safe

function chunk(text: string): string[] {
  if (text.length <= TG_LIMIT) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > TG_LIMIT) {
    let cut = rest.lastIndexOf('\n', TG_LIMIT);
    if (cut < TG_LIMIT * 0.5) cut = TG_LIMIT;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}

export class CoachBot {
  private bot: Bot;
  private readonly chatId: string;

  constructor() {
    this.bot = new Bot(config.telegramBotToken);
    this.chatId = config.telegramChatId;

    // Only respond to the owner; ignore everyone else.
    this.bot.on('message:text', async (ctx) => {
      const from = String(ctx.chat.id);
      if (from !== this.chatId) {
        logger.warn({ from }, 'Ignoring message from non-owner chat');
        return;
      }
      const text = ctx.message.text;
      try {
        await ctx.replyWithChatAction('typing');
        const reply = await handleUserMessage(text);
        for (const part of chunk(reply)) {
          await ctx.reply(part);
        }
      } catch (err) {
        logger.error({ err }, 'Failed handling inbound message');
        try {
          await ctx.reply('Hit a snag on my end — try that again in a moment.');
        } catch {
          /* ignore */
        }
      }
    });

    this.bot.catch((err) => logger.error({ err: err.error }, 'grammY error'));
  }

  /** Send a message to the owner. Throws on failure (delivery queue handles retry). */
  async sendMessage(text: string): Promise<void> {
    for (const part of chunk(text)) {
      await this.bot.api.sendMessage(this.chatId, part);
    }
  }

  private polling = false;

  async start(): Promise<void> {
    // Validate the token / connectivity up front so a bad token fails loudly at
    // startup instead of silently never polling. init() calls getMe().
    await this.bot.init();
    logger.info({ username: this.bot.botInfo.username }, 'Telegram bot validated');
    this.startPolling();
  }

  /**
   * Long-poll, re-arming on failure. A 409 ("terminated by other getUpdates")
   * can happen transiently during a restart. We guard with `polling` so we never
   * run two overlapping pollers (which would 409 against each other forever), and
   * we fully stop() before retrying so the previous getUpdates connection clears.
   */
  private startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    void this.bot
      .start({
        onStart: (info) =>
          logger.info({ username: info.username }, 'Telegram bot started (long-polling)'),
      })
      .catch(async (err) => {
        this.polling = false;
        logger.warn({ err: (err as Error)?.message }, 'Telegram polling stopped; retrying in 15s');
        await this.bot.stop().catch(() => undefined);
        setTimeout(() => this.startPolling(), 15_000);
      });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    logger.info('Telegram bot stopped');
  }
}
