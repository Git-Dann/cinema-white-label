'use client';

import { FormEvent, useState } from 'react';
import { api, errorMessage, tenantPath } from '@/lib/api';
import { useSession, useTenantData } from '@/lib/session';
import { ErrorNote } from '@/components/ui';

/*
 * Ask Pulse: the conversational part of the AI layer. Shown only when the platform has switched
 * it on (docs/decisions/0007-ask-pulse.md); every figure in an answer comes from Pulse.
 */

type Turn = { role: 'user' | 'assistant'; text: string; tools?: string[] };
const TOOL_NAMES: Record<string, string> = {
  pulse_brief: 'this week’s brief',
  pulse_venues: 'your cinemas',
  pulse_forecasts: 'forecasts',
  pulse_simulate: 'a what-if',
  pulse_accuracy: 'accuracy',
  pulse_learned: 'what Pulse has learned',
};
const SUGGESTIONS = ['What should I do this week?', 'Would a late show of our busiest film on Saturday pay?', 'How accurate are your forecasts?'];

export function AskPulse() {
  const { tenant } = useSession();
  const status = useTenantData<{ configured: boolean }>(tenantPath(tenant, '/pulse/ask'));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status.data?.configured) return null;

  async function send(question: string) {
    const text = question.trim();
    if (text.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    setQ('');
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: 'user', text }]);
    try {
      const r = await api<{ answer: string; toolCalls: { name: string }[] }>(tenantPath(tenant, '/pulse/ask'), { method: 'POST', body: { question: text, history } });
      setTurns((t) => [...t, { role: 'assistant', text: r.answer, tools: [...new Set(r.toolCalls.map((c) => TOOL_NAMES[c.name] ?? c.name))] }]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ask-pulse" aria-labelledby="ask-pulse-h">
      <h3 id="ask-pulse-h" className="ai-kicker">
        <span className="ai-spark" aria-hidden="true">✦</span> Ask Pulse
      </h3>
      {turns.length > 0 && (
        <ol className="ask-turns">
          {turns.map((t, i) => (
            <li key={i} className={t.role}>
              {t.text.split(/\n{2,}/).map((p, j) => (
                <p key={j}>{p}</p>
              ))}
              {t.tools && t.tools.length > 0 && <span className="muted small">Checked {t.tools.join(', ')}</span>}
            </li>
          ))}
          {busy && <li className="assistant muted">Checking Pulse…</li>}
        </ol>
      )}
      <ErrorNote message={error ?? undefined} />
      <form
        className="ask-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          send(q);
        }}
      >
        <input aria-label="Ask Pulse a question" placeholder="Ask about forecasts, prices, screens or staffing" value={q} maxLength={1000} onChange={(e) => setQ(e.target.value)} disabled={busy} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || q.trim().length < 2}>
          Ask
        </button>
      </form>
      {turns.length === 0 && (
        <div className="row gap-1 ask-suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
