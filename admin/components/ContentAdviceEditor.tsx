'use client';

import { useEffect, useState } from 'react';
import { AdviceLevel, api, ContentAdviceItem, errorMessage, Film, tenantPath } from '@/lib/api';
import { ErrorNote, SuccessNote } from '@/components/ui';

/*
 * Parents Guide for one film: one row per BBFC category with a level. The app shows
 * these as cards after the certificate. Typed-in advice is kept when the film list
 * refreshes from the film data provider.
 */

const CATEGORIES = ['Violence', 'Language', 'Frightening & intense', 'Sex & nudity', 'Alcohol & drugs', 'Discrimination', 'Self-harm', 'Injury detail'];
const LEVELS: AdviceLevel[] = ['Strong', 'Moderate', 'Mild', 'Contains'];

export function ContentAdviceEditor({ tenant, film, canEdit, onSaved }: { tenant: string; film: Film; canEdit: boolean; onSaved: (f: Film) => void }) {
  const [rows, setRows] = useState<ContentAdviceItem[]>(film.contentAdvice?.items ?? []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  // A different film starts clean; a save on this film keeps its confirmation.
  useEffect(() => setMsg({}), [film.id]);
  useEffect(() => setRows(film.contentAdvice?.items ?? []), [film.id, film.contentAdvice]);

  const unused = CATEGORIES.filter((c) => !rows.some((r) => r.category === c));
  const setRow = (i: number, patch: Partial<ContentAdviceItem>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setMsg({});
    try {
      const f = await api<Film>(tenantPath(tenant, `/films/${film.id}/content-advice`), { method: 'PUT', body: { items: rows.map((r) => ({ ...r, text: r.text.trim() })) } });
      onSaved(f);
      setMsg({ ok: rows.length ? 'Parents Guide saved. The app shows it straight away.' : 'Advice cleared. The app shows the certificate only.' });
    } catch (err) {
      setMsg({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="advice-editor" aria-labelledby="advice-title">
      <div className="row between">
        <h3 id="advice-title" className="h4">
          Parents Guide
        </h3>
        {film.contentAdvice && (
          <a className="small" href={film.contentAdvice.moreInfoUrl} target="_blank" rel="noreferrer">
            Look up on BBFC ↗
          </a>
        )}
      </div>
      <p className="muted small">
        {film.certificate}
        {film.contentAdvice?.meaning ? `: ${film.contentAdvice.meaning}` : ''}. Add the BBFC content advice so parents see it in the app.
        {film.contentAdvice?.source === 'operator' ? ' Entered here, so it is kept when films refresh.' : ''}
      </p>
      {rows.length === 0 && <p className="muted small">No advice yet.</p>}
      <ul className="advice-rows">
        {rows.map((r, i) => (
          <li key={i} className="advice-row">
            <label className="visually-hidden" htmlFor={`adv-cat-${i}`}>Category</label>
            <input id={`adv-cat-${i}`} list="advice-categories" value={r.category} disabled={!canEdit} onChange={(e) => setRow(i, { category: e.target.value })} />
            <label className="visually-hidden" htmlFor={`adv-level-${i}`}>Level</label>
            <select id={`adv-level-${i}`} value={r.level} disabled={!canEdit} onChange={(e) => setRow(i, { level: e.target.value as AdviceLevel })}>
              {LEVELS.map((l) => <option key={l}>{l}</option>)}
            </select>
            <label className="visually-hidden" htmlFor={`adv-text-${i}`}>BBFC wording</label>
            <input id={`adv-text-${i}`} placeholder="BBFC wording, e.g. strong bloody violence" value={r.text} disabled={!canEdit} onChange={(e) => setRow(i, { text: e.target.value })} />
            {canEdit && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove ${r.category}`}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <datalist id="advice-categories">
        {CATEGORIES.map((c) => <option key={c} value={c} />)}
      </datalist>
      <ErrorNote message={msg.error} />
      <SuccessNote message={msg.ok} />
      {canEdit && (
        <div className="row gap-1">
          <button type="button" className="btn btn-sm" disabled={rows.length >= 12} onClick={() => setRows((rs) => [...rs, { category: unused[0] ?? '', level: 'Moderate', text: '' }])}>
            Add category
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || rows.some((r) => !r.category.trim())}>
            {busy ? 'Saving…' : 'Save Parents Guide'}
          </button>
        </div>
      )}
    </section>
  );
}
