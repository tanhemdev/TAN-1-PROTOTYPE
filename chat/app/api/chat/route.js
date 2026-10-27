import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from '../../../lib/system-prompt.js';
import { sanitizeMessages } from '../../../lib/validate.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'This deployment has no ANTHROPIC_API_KEY set.' }, { status: 500 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  const checked = sanitizeMessages(body?.messages);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });

  // Created per request so builds and previews work without a key.
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: checked.messages,
  });

  const encoder = new TextEncoder();
  const body$ = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        console.error('chat stream failed', err);
        controller.enqueue(encoder.encode('\n\nSorry, something went wrong on my end. Please try again.'));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body$, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
