'use client';

import { useEffect, useRef, useState } from 'react';

const STARTERS = [
  'My daughter was just diagnosed with type 1. Where do I even start?',
  'Any tips to make changing a CGM sensor hurt less?',
  "How do I explain my diabetes to new friends at college?",
  'What should a babysitter know about lows?',
];

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  async function send(text) {
    const content = text.trim();
    if (!content || busy) return;
    const history = [...messages, { role: 'user', content }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Something went wrong (${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let reply = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        setMessages([...history, { role: 'assistant', content: reply }]);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages([...history, { role: 'assistant', content: `Sorry, I couldn't answer just now. ${err.message}`, error: true }]);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <main className="shell">
      <header className="top">
        <div className="logo" aria-hidden="true">T</div>
        <div>
          <h1>Tan-Bot</h1>
          <p>A companion for people living with diabetes and the people who love them. Not a doctor: for doses or medication changes, ask your care team.</p>
        </div>
      </header>

      <section className="thread" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty">
            <p>Ask anything, any time. Here are a few things people ask:</p>
            <div className="starters">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`msg ${m.role} ${m.error ? 'error' : ''}`}>
              {m.content || (busy && i === messages.length - 1 ? <span className="typing">Tan-Bot is typing…</span> : null)}
            </div>
          ))
        )}
        <div ref={endRef} />
      </section>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Type a question…"
          rows={2}
          maxLength={4000}
          aria-label="Your message"
        />
        {busy ? (
          <button type="button" className="stop" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>
            Send
          </button>
        )}
      </form>
      <p className="note">In an emergency, call 911. If you're struggling, you can call or text 988 any time.</p>
    </main>
  );
}
