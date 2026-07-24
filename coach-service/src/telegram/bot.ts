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
      // Telegram's typing indicator lasts ~5s; a multi-tool Sonnet turn can run
      // much longer — keep it alive so Matt sees "typing…" instead of dead air.
      const typing = setInterval(
        () => void ctx.replyWithChatAction('typing').catch(() => undefined),
        4_500,
      );
      try {
        await ctx.replyWithChatAction('typing');
        const reply = await handleUserMessage(text);
        clearInterval(typing);
        for (const part of chunk(reply)) {
          await this.sendPart(part);
        }
      } catch (err) {
        logger.error({ err }, 'Failed handling inbound message');
        try {
          await ctx.reply('Hit a snag on my end — try that again in a moment.');
        } catch {
          /* ignore */
        }
      } finally {
        clearInterval(typing);
      }
    });

    // Photos (meal pics): download, pass to the vision turn with the caption.
    this.bot.on('message:photo', async (ctx) => {
      const from = String(ctx.chat.id);
      if (from !== this.chatId) {
        logger.warn({ from }, 'Ignoring photo from non-owner chat');
        return;
      }
      const caption = ctx.message.caption ?? '';
      const typing = setInterval(
        () => void ctx.replyWithChatAction('typing').catch(() => undefined),
        4_500,
      );
      try {
        await ctx.replyWithChatAction('typing');
        const sizes = ctx.message.photo;
        const best = sizes[sizes.length - 1]; // largest rendition
        const file = await ctx.api.getFile(best.file_id);
        const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
        const res = await fetch(url);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 4_500_000) {
          await ctx.reply("That photo's too large for me to read — mind describing it instead?");
          return;
        }
        const reply = await handleUserMessage({
          text: caption,
          image: { base64: buf.toString('base64'), mediaType: 'image/jpeg' },
        });
        clearInterval(typing);
        for (const part of chunk(reply)) {
          await this.sendPart(part);
        }
      } catch (err) {
        logger.error({ err }, 'Failed handling inbound photo');
        try {
          await ctx.reply("Couldn't process that photo — try again or just describe it.");
        } catch {
          /* ignore */
        }
      } finally {
        clearInterval(typing);
      }
    });

    // Voice/audio: no transcription path yet — fail gracefully instead of silently.
    this.bot.on(['message:voice', 'message:audio', 'message:video_note'], async (ctx) => {
      const from = String(ctx.chat.id);
      if (from !== this.chatId) return;
      try {
        await ctx.reply("Can't listen to voice notes yet — shoot me a text and I'm on it. 📝");
      } catch {
        /* ignore */
      }
    });

    this.bot.catch((err) => logger.error({ err: err.error }, 'grammY error'));
  }

  /**
   * Send one chunk with formatting: the model writes **bold** (not Telegram's
   * legacy *bold*), so convert, try Markdown, and fall back to plain text — a
   * malformed-markdown 400 must never swallow a coaching message.
   */
  private async sendPart(part: string): Promise<void> {
    const md = part.replace(/\*\*/g, '*');
    try {
      await this.bot.api.sendMessage(this.chatId, md, { parse_mode: 'Markdown' });
    } catch {
      await this.bot.api.sendMessage(this.chatId, part);
    }
  }

  /** Send a message to the owner. Throws on failure (delivery queue handles retry). */
  async sendMessage(text: string): Promise<void> {
    for (const part of chunk(text)) {
      await this.sendPart(part);
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
