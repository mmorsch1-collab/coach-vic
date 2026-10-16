/**
 * One-off smoke test for request params the pinned SDK (0.40.1) doesn't type:
 * cache_control ttl '1h', output_config.effort, tool_choice 'none'.
 * Tiny prompts — costs a fraction of a cent. Run: npx tsx scripts/smokeParams.ts
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function main() {
  // Sonnet 5.5: ttl + effort + between_tools thinking + tool_choice none, with a dummy tool present.
  const r1 = await client.messages.create({
    model: 'claude-sonnet-5-5',
    max_tokens: 16,
    thinking: { type: 'between_tools' },
    system: [{ type: 'text', text: 'Reply with one word.', cache_control: { type: 'ephemeral', ttl: '1h' } }],
    tools: [{ name: 'noop', description: 'never use', input_schema: { type: 'object', properties: {} } }],
    tool_choice: { type: 'none' },
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Say OK', cache_control: { type: 'ephemeral', ttl: '1h' } }] }],
  } as any);
  console.log('sonnet-5-5 OK:', JSON.stringify({ stop: r1.stop_reason, usage: r1.usage }));

  // Haiku: plain ephemeral + tool_choice none (no effort — would 400).
  const r2 = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 16,
    system: [{ type: 'text', text: 'Reply with one word.', cache_control: { type: 'ephemeral' } }],
    tools: [{ name: 'noop', description: 'never use', input_schema: { type: 'object', properties: {} } }],
    tool_choice: { type: 'none' },
    messages: [{ role: 'user', content: 'Say OK' }],
  } as any);
  console.log('haiku-4-5 OK:', JSON.stringify({ stop: r2.stop_reason, usage: r2.usage }));
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e?.status, e?.message);
  process.exit(1);
});
