// Checks and trims the chat history the browser sends, before it reaches the
// model. Pure function so it's unit-tested (tests/validate.test.mjs).

export const LIMITS = { maxMessages: 40, keepLast: 20, maxChars: 4000 };

export function sanitizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'messages must be a non-empty array' };
  if (input.length > LIMITS.maxMessages) return { ok: false, error: `at most ${LIMITS.maxMessages} messages` };
  const clean = [];
  for (const m of input) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return { ok: false, error: 'each message needs role "user" or "assistant" and string content' };
    }
    const content = m.content.trim();
    if (!content) continue;
    if (content.length > LIMITS.maxChars) return { ok: false, error: `messages are limited to ${LIMITS.maxChars} characters` };
    const prev = clean[clean.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n\n${content}`;
    else clean.push({ role: m.role, content });
  }
  let messages = clean.slice(-LIMITS.keepLast);
  while (messages.length && messages[0].role !== 'user') messages = messages.slice(1);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return { ok: false, error: 'the last message must be from the user' };
  }
  return { ok: true, messages };
}
