'use client';

import { FormEvent, useRef, useState } from 'react';
import { api, AuditoriumSummary, errorDetails, errorMessage, LayoutVersionDetail, SeatCategoriesResponse, tenantPath, VenueAuditoriums } from '@/lib/api';
import { useSession, useTenantData } from '@/lib/session';
import { formatDate, formatDateTime } from '@/lib/format';
import { DEFAULT_GENERATOR, emptyLayout, generateLayout } from '@/lib/layout-tools';
import { LayoutEditor } from '@/components/LayoutEditor';
import { ApiErrorNote, ErrorNote, Loading, PageHeader, StatusBadge, SuccessNote } from '@/components/ui';
import { Sheet, TileHit } from '@/components/Sheet';
import { useCinemaScope } from '@/lib/cinema-scope';

type ApiErr = { message: string; details: string[] } | null;

export default function LayoutsPage() {
  const { tenant, can } = useSession();
  const list = useTenantData<VenueAuditoriums[]>(tenantPath(tenant, '/auditoriums'));
  const scope = useCinemaScope();
  const shownVenues = (list.data ?? []).filter((v) => scope.includes(v.venue.id));
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
    const first = shownVenues[0] ?? list.data?.[0];
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

      <Sheet
        open={!!newScreen}
        narrow
        title="New screen"
        subtitle="A starter seat map with 8 rows is created so you can shape it in the editor."
        onClose={() => setNewScreen(null)}
        onSubmit={createScreen}
        footer={
          <>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create screen'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setNewScreen(null)}>
              Cancel
            </button>
          </>
        }
      >
        {newScreen && (
          <div className="form-grid">
            <div className="field span-2">
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
              <input id="ns-number" className="input-short" type="number" min={1} max={99} value={newScreen.screenNumber} onChange={(e) => setNewScreen({ ...newScreen, screenNumber: e.target.value })} />
            </div>
          </div>
        )}
        <ApiErrorNote error={formError} />
      </Sheet>

      {list.loading && !list.data && <Loading />}
      {shownVenues.map((v) => (
        <section className="venue-block" key={v.venue.id} aria-labelledby={`venue-${v.venue.id}`}>
          <h2 id={`venue-${v.venue.id}`} className="h3 section-title">
            {v.venue.name} <span className="muted small">{v.auditoriums.length} screen{v.auditoriums.length === 1 ? '' : 's'}</span>
          </h2>
          {v.auditoriums.length === 0 ? (
            <p className="muted">No screens yet.</p>
          ) : (
            <ul className="tile-grid">
              {v.auditoriums.map((a) => {
                const live = a.versions.find((ver) => ver.status === 'PUBLISHED');
                // The card opens the draft being worked on, else the live map; older versions stay listed.
                const latest = a.versions.find((ver) => ver.status === 'DRAFT') ?? live ?? a.versions[0];
                const draft = a.versions.find((ver) => ver.status === 'DRAFT');
                const older = a.versions.filter((ver) => ver !== latest);
                const canOpen = latest ? true : can.canEditLayouts;
                return (
                  <li key={a.id} className={`card tile screen-tile${canOpen ? ' tile-click' : ''}`}>
                    {canOpen && (
                      <TileHit
                        label={latest ? `Open ${a.name} seat map` : `Start a seat map for ${a.name}`}
                        onClick={() => (latest ? open(latest.id) : startFirstDraft(a))}
                        disabled={opening === (latest?.id ?? a.id)}
                      />
                    )}
                    <div className="tile-head">
                      <div>
                        <div className="tile-title">{a.name}</div>
                        <div className="muted small">
                          {a.name !== `Screen ${a.screenNumber}` ? `Screen ${a.screenNumber} · ` : ''}
                          {live ? `Live since ${formatDate(live.publishedAt ?? live.createdAt)}` : 'Not live yet'}
                        </div>
                      </div>
                      {live && (
                        <div className="venue-screens">
                          <span className="num">{live.seatCount}</span>
                          <span className="muted small">seats</span>
                        </div>
                      )}
                    </div>
                    <div className="screen-foot">
                      {a.versions.length === 0 ? (
                        <span className="muted small">{can.canEditLayouts ? 'No seat map yet. Click to start one.' : 'No seat map yet'}</span>
                      ) : (
                        <span className="row gap-1">
                          {live && <StatusBadge status="PUBLISHED" />}
                          {draft && <span className="badge badge-warning">Draft v{draft.version} in progress</span>}
                        </span>
                      )}
                      {older.length > 0 && (
                        <details className="screen-versions tile-above">
                          <summary className="small muted">{older.length} other version{older.length === 1 ? '' : 's'}</summary>
                          <ul className="version-list">
                            {older.map((ver) => (
                              <li key={ver.id}>
                                <button className="version-btn" onClick={() => open(ver.id)} disabled={opening === ver.id} aria-label={`Open ${a.name} version ${ver.version} (${ver.status.toLowerCase()})`}>
                                  <span className="strong">v{ver.version}</span>
                                  <StatusBadge status={ver.status} />
                                  <span className="muted small">{ver.publishedAt ? formatDateTime(ver.publishedAt) : `draft, ${formatDateTime(ver.createdAt)}`}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
