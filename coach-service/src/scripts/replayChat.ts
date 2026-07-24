import { handleUserMessage } from '../telegram/chat.js';
import { logger } from '../logger.js';

/**
 * Pre-swap chat validation WITHOUT the Telegram bot: pipe a message in and see
 * Coach Vic's reply (exercises the full agent loop, tools, and memory).
 *
 *   npm run chat -- "what should I do today?"
 *   npm run chat -- "had 5 eggs and chicken for lunch"
 */
const text = process.argv.slice(2).join(' ').trim();
if (!text) {
  console.error('Usage: npm run chat -- "your message"');
  process.exit(1);
}

handleUserMessage(text)
  .then((reply) => {
    console.log('\n===== COACH VIC =====\n');
    console.log(reply);
    console.log('\n=====================\n');
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'Chat replay failed');
    process.exit(1);
  });
