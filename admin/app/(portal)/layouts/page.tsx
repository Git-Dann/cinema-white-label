'use client';

import { FormEvent, useRef, useState } from 'react';
import { api, AuditoriumSummary, errorDetails, errorMessage, LayoutVersionDetail, SeatCategoriesResponse, tenantPath, VenueAuditoriums } from '@/lib/api';
import { useSession, useTenantData } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { DEFAULT_GENERATOR, emptyLayout, generateLayout } from '@/lib/layout-tools';
import { LayoutEditor } from '@/components/LayoutEditor';
import { ApiErrorNote, ErrorNote, Loading, PageHeader, StatusBadge, SuccessNote } from '@/components/ui';

type ApiErr = { message: string; details: string[] } | null;

export default function LayoutsPage() {
  const { tenant, can } = useSession();
  const list = useTenantData<VenueAuditoriums[]>(tenantPath(tenant, '/auditoriums'));
  const cats = useTenantData<SeatCategoriesResponse>(tenantPath(tenant, '/seat-categories'));
  const [detail, setDetail] = useState<LayoutVersionDetail | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [newScreen, setNewScreen] = useState<{ venueId: string; name: string; screenNumber: string } | null>(null);
  const [formError, setFormError] = useState<ApiErr>(null);
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(false);

  async function open(versionId: string) {
    setOpening(versionId);
    setMsg({});
    try {
      setDetail(await api<LayoutVersionDetail>(tenantPath(tenant, `/layouts/${versionId}`)));
      window.scrollTo({ top: 0 });
    } catch (e) {
      setMsg({ error: errorMessage(e) });
    } finally {
      setOpening(null);
    }
  }

  async function startFirstDraft(a: AuditoriumSummary) {
    setOpening(a.id);
    setMsg({});
    try {
      const geometry = generateLayout(emptyLayout(`layout-${a.id}`, a.name), {
        ...DEFAULT_GENERATOR,
        priceCategory: cats.data?.categories.some((c) => c.id === 'standard') ? 'standard' : cats.data?.categories[0]?.id ?? 'standard',
      });
      const d = await api<LayoutVersionDetail>(tenantPath(tenant, `/auditoriums/${a.id}/layouts`), { method: 'POST', body: { geometry } });
      list.reload();
      setDetail(d);
      return true;
    } catch (e) {
      setMsg({ error: errorMessage(e) });
      return false;
    } finally {
      setOpening(null);
    }
  }

  function startNewScreen() {
    const first = list.data?.[0];
    const nextNumber = first ? Math.max(0, ...first.auditoriums.map((a) => a.screenNumber)) + 1 : 1;
    setNewScreen({ venueId: first?.venue.id ?? '', name: `Screen ${nextNumber}`, screenNumber: String(nextNumber) });
    setFormError(null);
    setMsg({});
  }

  function pickVenue(venueId: string) {
    const v = list.data?.find((x) => x.venue.id === venueId);
    const n = v ? Math.max(0, ...v.auditoriums.map((a) => a.screenNumber)) + 1 : 1;
    setNewScreen((s) => (s ? { ...s, venueId, screenNumber: String(n), name: /^Screen \d+$/.test(s.name) ? `Screen ${n}` : s.name } : s));
  }

  async function createScreen(e: FormEvent) {
    e.preventDefault();
    if (!newScreen) return;
    const screenNumber = Number.parseInt(newScreen.screenNumber, 10);
    if (!newScreen.venueId) return setFormError({ message: 'Choose a cinema.', details: [] });
    if (!newScreen.name.trim()) return setFormError({ message: 'Enter a screen name.', details: [] });
    if (!Number.isFinite(screenNumber) || screenNumber < 1 || screenNumber > 99) return setFormError({ message: 'Screen number must be from 1 to 99.', details: [] });
    setBusy(true);
    setFormError(null);
    try {
      const aud = await api<AuditoriumSummary>(tenantPath(tenant, `/venues/${newScreen.venueId}/auditoriums`), { method: 'POST', body: { name: newScreen.name.trim(), screenNumber } });
      setNewScreen(null);
      setMsg({ ok: `${aud.name} created with a starter draft layout.` });
      await startFirstDraft(aud);
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    } finally {
      setBusy(false);
    }
  }

  if (detail) {
    return (
      <>
        <div className="back-row">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (dirtyRef.current && !window.confirm('Leave the editor without saving your changes?')) return;
              dirtyRef.current = false;
              setDetail(null);
              list.reload();
            }}
          >
            ← All screens
          </button>
        </div>
        <SuccessNote message={msg.ok} />
        {cats.data ? (
          <LayoutEditor
            key={detail.id}
            detail={detail}
            categories={cats.data.categories}
            onDetail={setDetail}
            onOpen={(d) => {
              setMsg({ ok: `Draft version ${d.version} created.` });
              setDetail(d);
            }}
            onDeleted={() => {
              dirtyRef.current = false;
              setDetail(null);
              list.reload();
              setMsg({ ok: 'Draft deleted.' });
            }}
            onChanged={() => list.reload()}
            onDirtyChange={(d) => (dirtyRef.current = d)}
          />
        ) : (
          <Loading />
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Auditorium layouts"
        description="Seat maps for each screen. Published layouts are fixed; changes go into a new draft version, and existing screenings keep the version they were scheduled with."
        actions={
          can.canEditLayouts && (
            <button className="btn btn-primary" onClick={startNewScreen} disabled={!list.data?.length}>
              New screen
            </button>
          )
        }
      />
      <ErrorNote message={msg.error ?? list.error ?? cats.error} />
      <SuccessNote message={msg.ok} />

      {newScreen && (
        <section className="card" aria-labelledby="ns-title">
          <h2 id="ns-title" className="h3">
            New screen
          </h2>
          <form onSubmit={createScreen} noValidate>
            <div className="form-grid cols-3">
              <div className="field">
                <label htmlFor="ns-venue">Cinema</label>
                <select id="ns-venue" value={newScreen.venueId} onChange={(e) => pickVenue(e.target.value)}>
                  {(list.data ?? []).map((v) => (
                    <option key={v.venue.id} value={v.venue.id}>
                      {v.venue.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ns-name">Name</label>
                <input id="ns-name" maxLength={40} value={newScreen.name} onChange={(e) => setNewScreen({ ...newScreen, name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ns-number">Screen number</label>
                <input id="ns-number" type="number" min={1} max={99} value={newScreen.screenNumber} onChange={(e) => setNewScreen({ ...newScreen, screenNumber: e.target.value })} />
              </div>
            </div>
            <p className="help mb-2">A starter draft with 8 rows is created so you can shape it in the editor.</p>
            <ApiErrorNote error={formError} />
            <div className="row gap-1">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create screen'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setNewScreen(null)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {list.loading && !list.data && <Loading />}
      {list.data?.map((v) => (
        <section className="card" key={v.venue.id} aria-labelledby={`venue-${v.venue.id}`}>
          <h2 id={`venue-${v.venue.id}`} className="h3">
            {v.venue.name}
          </h2>
          {v.auditoriums.length === 0 ? (
            <p className="muted">No screens yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Screen</th>
                    <th scope="col">Versions</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {v.auditoriums.map((a) => (
                    <tr key={a.id}>
                      <td className="screen-cell">
                        <div className="strong">{a.name}</div>
                        {a.name !== `Screen ${a.screenNumber}` && <div className="muted small">Screen {a.screenNumber}</div>}
                      </td>
                      <td>
                        {a.versions.length === 0 ? (
                          <span className="muted small">No layout yet</span>
                        ) : (
                          <ul className="version-list">
                            {a.versions.map((ver) => (
                              <li key={ver.id}>
                                <button className="version-btn" onClick={() => open(ver.id)} disabled={opening === ver.id} aria-label={`Open ${a.name} version ${ver.version} (${ver.status.toLowerCase()})`}>
                                  <span className="strong">v{ver.version}</span>
                                  <StatusBadge status={ver.status} />
                                  <span className="muted small">
                                    {ver.seatCount} seats · {ver.publishedAt ? `published ${formatDateTime(ver.publishedAt)}` : `created ${formatDateTime(ver.createdAt)}`}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="actions">
                        {a.versions.length === 0 && can.canEditLayouts && (
                          <button className="btn btn-sm" onClick={() => startFirstDraft(a)} disabled={opening === a.id}>
                            Start layout
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </>
  );
}
