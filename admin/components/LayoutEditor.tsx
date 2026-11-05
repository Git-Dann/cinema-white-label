'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuditoriumLayout, Seat, SeatType } from '@cinema/contracts';
import { ACCESS_FEATURES } from '@cinema/contracts';
import { api, ApiError, errorDetails, errorMessage, LayoutIssueDto, LayoutValidation, LayoutVersionDetail, SeatCategoryDto, tenantPath } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import {
  ACCESS_LABELS,
  DEFAULT_GENERATOR,
  deleteSeats,
  fitCanvasHeight,
  freeGroupId,
  generatedRowWidth,
  generateLayout,
  GeneratorSettings,
  mapSeats,
  nudgeSeats,
  ROW_LETTERS,
  SEAT_TYPE_LABELS,
  SEAT_TYPES,
  TYPE_TO_CATEGORY,
} from '@/lib/layout-tools';
import { SeatLegend, SeatMap } from './SeatMap';
import { ApiErrorNote, ReadOnlyNote, StatusBadge, SuccessNote } from './ui';

type ApiErr = { message: string; details: string[] } | null;
const toErr = (e: unknown): ApiErr => ({ message: errorMessage(e), details: errorDetails(e) });

const SMALL_STEP = 0.002;
const BIG_STEP = 0.01;

function NumField({
  id,
  label,
  value,
  onChange,
  step,
  min,
  max,
  help,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  step: number;
  min?: number;
  max?: number;
  help?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number.parseFloat(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        step={step}
        min={min}
        max={max}
        value={text}
        disabled={disabled}
        aria-describedby={help ? `${id}-help` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number.parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
      {help && (
        <p id={`${id}-help`} className="help">
          {help}
        </p>
      )}
    </div>
  );
}

function common<T>(seats: Seat[], f: (s: Seat) => T): T | undefined {
  if (seats.length === 0) return undefined;
  const first = JSON.stringify(f(seats[0]));
  return seats.every((s) => JSON.stringify(f(s)) === first) ? f(seats[0]) : undefined;
}

export function LayoutEditor({
  detail,
  categories,
  onDetail,
  onOpen,
  onDeleted,
  onChanged,
  onDirtyChange,
}: {
  detail: LayoutVersionDetail;
  categories: SeatCategoryDto[];
  /** The same version changed on the server (saved or published). */
  onDetail: (d: LayoutVersionDetail) => void;
  /** A different version should open (e.g. a new draft). */
  onOpen: (d: LayoutVersionDetail) => void;
  onDeleted: () => void;
  /** Something changed that the auditorium list should reflect. */
  onChanged: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { tenant, can } = useSession();
  const readOnly = detail.status !== 'DRAFT' || !can.canEditLayouts;
  const isDraft = detail.status === 'DRAFT';
  const [geometry, setGeometry] = useState<AuditoriumLayout>(detail.geometry);
  const [saved, setSaved] = useState<AuditoriumLayout>(detail.geometry);
  const [selected, setSelected] = useState<string[]>([]);
  const [issues, setIssues] = useState<LayoutIssueDto[]>(detail.issues);
  const [schemaError, setSchemaError] = useState<ApiErr>(null);
  const [validating, setValidating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: ApiErr }>({});
  const [gen, setGen] = useState<GeneratorSettings>(() => ({
    ...DEFAULT_GENERATOR,
    priceCategory: categories.some((c) => c.id === 'standard') ? 'standard' : categories[0]?.id ?? 'standard',
  }));
  const canvasRef = useRef<HTMLDivElement>(null);
  const dirty = geometry !== saved;

  // Live validation against the server (debounced) for drafts.
  useEffect(() => {
    if (readOnly) return;
    const ctrl = new AbortController();
    setValidating(true);
    const t = setTimeout(() => {
      api<LayoutValidation>(tenantPath(tenant, '/layouts/validate'), { method: 'POST', body: { geometry }, signal: ctrl.signal })
        .then((r) => {
          setIssues(r.issues);
          setSchemaError(null);
        })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          setSchemaError({ message: `The layout data is invalid: ${errorMessage(e)}`, details: errorDetails(e) });
        })
        .finally(() => !ctrl.signal.aborted && setValidating(false));
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [geometry, readOnly, tenant]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    onDirtyChange?.(dirty);
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const selSet = useMemo(() => new Set(selected), [selected]);
  const selSeats = useMemo(() => geometry.seats.filter((s) => selSet.has(s.id)), [geometry.seats, selSet]);
  const issueSeatIds = useMemo(() => new Set(issues.map((i) => i.seatId).filter((x): x is string => !!x)), [issues]);
  const wheelchairSeats = useMemo(() => geometry.seats.filter((s) => s.type === 'wheelchair'), [geometry.seats]);

  const edit = useCallback((fn: (l: AuditoriumLayout) => AuditoriumLayout) => {
    setGeometry((g) => fn(g));
    setMsg({});
  }, []);
  const editSelected = (fn: (s: Seat) => Seat) => edit((l) => mapSeats(l, selSet, fn));

  function onSeatClick(id: string, additive: boolean) {
    canvasRef.current?.focus({ preventScroll: true });
    setSelected((cur) => (additive ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : cur.length === 1 && cur[0] === id ? [] : [id]));
  }

  function removeSelected() {
    if (!selected.length || readOnly) return;
    edit((l) => deleteSeats(l, selSet));
    setSelected([]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') return setSelected([]);
    if (readOnly || selected.length === 0) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeSelected();
      return;
    }
    const step = e.shiftKey ? BIG_STEP : SMALL_STEP;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (d[e.key]) {
      e.preventDefault();
      edit((l) => nudgeSeats(l, selSet, d[e.key][0], d[e.key][1]));
    }
  }

  function generate() {
    if (geometry.seats.length > 0 && !window.confirm(`Replace all ${geometry.seats.length} seats with ${gen.rows} generated rows?`)) return;
    edit((l) => generateLayout(l, gen));
    setSelected([]);
  }

  // ---- Quick actions ----
  function makeGroup(asSofa: boolean) {
    if (selSeats.length < 2) return;
    const gid = freeGroupId(geometry, selSeats[0].rowId, asSofa ? 'sofa' : 'pair');
    const sofaCat = categories.find((c) => c.id === 'sofa')?.id;
    editSelected((s) => ({ ...s, groupId: gid, ...(asSofa ? { type: 'sofa' as SeatType, priceCategory: sofaCat ?? s.priceCategory } : {}) }));
  }
  function makeWheelchairPair() {
    if (selected.length !== 2) return;
    const [wid, cid] = selected;
    edit((l) =>
      mapSeats(l, selSet, (s) =>
        s.id === wid
          ? { ...s, type: 'wheelchair', accessibility: Array.from(new Set([...s.accessibility, 'wheelchair' as const])), companionFor: [], groupId: null }
          : s.id === cid
            ? { ...s, type: 'companion', companionFor: [wid], groupId: null }
            : s,
      ),
    );
  }
  function selectRow() {
    if (!selSeats.length) return;
    const rows = new Set(selSeats.map((s) => s.rowId));
    setSelected(geometry.seats.filter((s) => rows.has(s.rowId)).map((s) => s.id));
  }

  // ---- Server actions ----
  async function save(): Promise<LayoutVersionDetail | null> {
    setBusy('save');
    setMsg({});
    try {
      const res = await api<LayoutVersionDetail>(tenantPath(tenant, `/layouts/${detail.id}`), { method: 'PUT', body: { geometry } });
      setSaved(geometry);
      setIssues(res.issues);
      onDetail(res);
      onChanged();
      setMsg({ ok: `Draft saved with ${res.seatCount} seats.` });
      return res;
    } catch (e) {
      setMsg({ error: toErr(e) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (dirty && !(await save())) return;
    if (!window.confirm(`Publish version ${detail.version}? New screenings will use it. Existing screenings keep their current layout.`)) return;
    setBusy('publish');
    setMsg({});
    try {
      const res = await api<LayoutVersionDetail>(tenantPath(tenant, `/layouts/${detail.id}/publish`), { method: 'POST' });
      onDetail(res);
      onChanged();
      setSelected([]);
      setMsg({ ok: `Version ${res.version} published.` });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'publish_blocked') {
        const list = (e.details as { issues?: LayoutIssueDto[] } | undefined)?.issues;
        if (Array.isArray(list)) setIssues(list);
      }
      setMsg({ error: toErr(e) });
    } finally {
      setBusy(null);
    }
  }

  async function deleteDraft() {
    if (!window.confirm(`Delete draft version ${detail.version}? This cannot be undone.`)) return;
    setBusy('delete');
    try {
      await api(tenantPath(tenant, `/layouts/${detail.id}`), { method: 'DELETE' });
      onChanged();
      onDeleted();
    } catch (e) {
      setMsg({ error: toErr(e) });
      setBusy(null);
    }
  }

  async function newDraft() {
    setBusy('new');
    setMsg({});
    try {
      const res = await api<LayoutVersionDetail>(tenantPath(tenant, `/auditoriums/${detail.auditorium.id}/layouts`), { method: 'POST', body: { geometry: detail.geometry } });
      onChanged();
      onOpen(res);
    } catch (e) {
      setMsg({ error: toErr(e) });
      setBusy(null);
    }
  }

  const publishBlock = !can.canPublishLayouts
    ? 'Only operator admins can publish layouts.'
    : schemaError
      ? 'Fix the layout data errors first.'
      : validating
        ? 'Checking the layout…'
        : issues.length
          ? `Resolve ${issues.length} issue${issues.length === 1 ? '' : 's'} before publishing.`
          : null;

  const rowWidth = generatedRowWidth(gen);
  const catOptions = categories.map((c) => (
    <option key={c.id} value={c.id}>
      {c.label}
    </option>
  ));
  const knownCat = (id: string) => categories.some((c) => c.id === id);

  const cType = common(selSeats, (s) => s.type);
  const cCat = common(selSeats, (s) => s.priceCategory);
  const cRestricted = common(selSeats, (s) => s.restrictedView ?? '');
  const cGroup = common(selSeats, (s) => s.groupId ?? '');
  const cWidth = common(selSeats, (s) => s.width);

  return (
    <div className="layout-editor">
      <div className="editor-bar card">
        <div>
          <div className="row gap-1">
            <h2 className="h2 no-margin">
              {detail.auditorium.name} · Version {detail.version}
            </h2>
            <StatusBadge status={detail.status} />
            {dirty && <span className="badge badge-warning">Unsaved changes</span>}
          </div>
          <p className="muted small no-margin">
            {geometry.seats.length} seats in {new Set(geometry.seats.map((s) => s.rowId)).size} rows
            {detail.publishedAt ? ` · Published ${formatDateTime(detail.publishedAt)}` : ` · Created ${formatDateTime(detail.createdAt)}`}
          </p>
        </div>
        <div className="editor-actions">
          {isDraft && can.canEditLayouts && (
            <>
              <button className="btn btn-ghost btn-danger" onClick={deleteDraft} disabled={!!busy}>
                {busy === 'delete' ? 'Deleting…' : 'Delete draft'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setGeometry(saved);
                  setSelected([]);
                }}
                disabled={!dirty || !!busy}
              >
                Revert
              </button>
              <button className="btn" onClick={save} disabled={!dirty || !!busy}>
                {busy === 'save' ? 'Saving…' : 'Save draft'}
              </button>
            </>
          )}
          {isDraft && (
            <span className="publish-wrap">
              <button className="btn btn-primary" onClick={publish} disabled={!!publishBlock || !!busy} aria-describedby="publish-reason" title={publishBlock ?? undefined}>
                {busy === 'publish' ? 'Publishing…' : dirty ? 'Save and publish' : 'Publish'}
              </button>
            </span>
          )}
          {!isDraft && can.canEditLayouts && (
            <button className="btn btn-primary" onClick={newDraft} disabled={!!busy}>
              {busy === 'new' ? 'Creating…' : 'New draft from this version'}
            </button>
          )}
        </div>
        {isDraft && publishBlock && (
          <p id="publish-reason" className="help publish-reason">
            Publishing unavailable: {publishBlock}
          </p>
        )}
      </div>

      <ApiErrorNote error={msg.error ?? null} />
      <SuccessNote message={msg.ok} />
      {!isDraft && (
        <ReadOnlyNote>
          This version is {detail.status.toLowerCase()} and cannot be changed. {detail.screenings} screening{detail.screenings === 1 ? '' : 's'} use it and keep this layout even after a newer version is
          published{can.canEditLayouts ? '. Start a new draft from it to make changes.' : '.'}
        </ReadOnlyNote>
      )}
      {isDraft && !can.canEditLayouts && <ReadOnlyNote>Your role can view this draft but not edit it.</ReadOnlyNote>}

      <div className="editor-layout">
        <section className="card editor-canvas" aria-label="Seat map">
          <div
            ref={canvasRef}
            className="canvas-focus"
            tabIndex={0}
            onKeyDown={onKeyDown}
            aria-label={readOnly ? 'Seat map. Click a seat to inspect it.' : 'Seat map editor. Click seats to select; Delete removes, arrow keys move selected seats.'}
          >
            <SeatMap layout={geometry} selected={selSet} issueSeatIds={issueSeatIds} onSeatClick={onSeatClick} onBackgroundClick={() => setSelected([])} />
          </div>
          <div className="canvas-foot">
            <SeatLegend layout={geometry} />
            <p className="help">
              Click a seat to select it; Shift-click to select more.
              {!readOnly && ' Delete removes selected seats; arrow keys move them (hold Shift for bigger steps).'} Seats with issues are outlined in red.
            </p>
          </div>
        </section>

        <div className="editor-side">
          <section className="card side-card" aria-labelledby="val-title">
            <div className="section-title">
              <h3 id="val-title" className="h3">
                Validation
              </h3>
              {!readOnly && validating ? (
                <span className="muted small">Checking…</span>
              ) : schemaError ? (
                <span className="badge badge-danger">Invalid</span>
              ) : issues.length ? (
                <span className="badge badge-danger">
                  {issues.length} issue{issues.length === 1 ? '' : 's'}
                </span>
              ) : (
                <span className="badge badge-success">{isDraft && can.canPublishLayouts ? 'Ready to publish' : 'No issues'}</span>
              )}
            </div>
            <ApiErrorNote error={schemaError} />
            {issues.length === 0 && !schemaError && <p className="muted small no-margin">No problems found. Seats, rows, companions, pairs and prices all pass.</p>}
            {issues.length > 0 && (
              <ul className="layout-issues">
                {issues.map((i, n) => (
                  <li key={n}>
                    <code>{i.code}</code>
                    <span>{i.message}</span>
                    {i.seatId && geometry.seats.some((s) => s.id === i.seatId) && (
                      <button className="btn btn-sm btn-ghost" onClick={() => setSelected([i.seatId as string])}>
                        Select
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card side-card" aria-labelledby="insp-title">
            <div className="section-title">
              <h3 id="insp-title" className="h3">
                Seat inspector
              </h3>
              {selSeats.length > 0 && (
                <div className="row gap-1">
                  <button className="btn btn-sm btn-ghost" onClick={selectRow}>
                    Select row
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setSelected([])}>
                    Clear
                  </button>
                </div>
              )}
            </div>
            {selSeats.length === 0 ? (
              <p className="muted small no-margin">Select a seat on the map to {readOnly ? 'see its details' : 'edit it'}.</p>
            ) : (
              <fieldset className="plain" disabled={readOnly}>
                <p className="small selection-summary">
                  <span className="strong">
                    {selSeats.length} seat{selSeats.length === 1 ? '' : 's'}:
                  </span>{' '}
                  {selSeats
                    .slice(0, 12)
                    .map((s) => s.id)
                    .join(', ')}
                  {selSeats.length > 12 ? ` and ${selSeats.length - 12} more` : ''}
                </p>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="si-type">Seat type</label>
                    <select id="si-type" value={cType ?? ''} onChange={(e) => editSelected((s) => ({ ...s, type: e.target.value as SeatType }))}>
                      {cType === undefined && (
                        <option value="" disabled>
                          Mixed
                        </option>
                      )}
                      {SEAT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {SEAT_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="si-cat">Price category</label>
                    <select id="si-cat" value={cCat ?? ''} onChange={(e) => editSelected((s) => ({ ...s, priceCategory: e.target.value }))}>
                      {cCat === undefined && (
                        <option value="" disabled>
                          Mixed
                        </option>
                      )}
                      {cCat !== undefined && !knownCat(cCat) && <option value={cCat}>{cCat} (unknown)</option>}
                      {catOptions}
                    </select>
                  </div>
                  <div className="field span-2">
                    <label htmlFor="si-rv">Restricted view</label>
                    <input
                      id="si-rv"
                      maxLength={80}
                      value={cRestricted ?? ''}
                      placeholder={cRestricted === undefined ? 'Mixed values' : 'None'}
                      onChange={(e) => editSelected((s) => ({ ...s, restrictedView: e.target.value || null }))}
                    />
                  </div>
                </div>
                <fieldset className="field">
                  <legend>Accessibility</legend>
                  <div className="check-grid compact-checks">
                    {ACCESS_FEATURES.map((f) => {
                      const all = selSeats.every((s) => s.accessibility.includes(f));
                      return (
                        <label key={f} className="check">
                          <input
                            type="checkbox"
                            checked={all}
                            onChange={() =>
                              editSelected((s) => ({ ...s, accessibility: all ? s.accessibility.filter((a) => a !== f) : Array.from(new Set([...s.accessibility, f])) }))
                            }
                          />
                          {ACCESS_LABELS[f]}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                {selSeats.length === 1 && (
                  <fieldset className="field">
                    <legend>Companion for</legend>
                    {wheelchairSeats.filter((w) => w.id !== selSeats[0].id).length === 0 ? (
                      <p className="help">No wheelchair spaces in this layout yet. Set a seat’s type to Wheelchair space first.</p>
                    ) : (
                      <div className="check-grid compact-checks">
                        {wheelchairSeats
                          .filter((w) => w.id !== selSeats[0].id)
                          .map((w) => {
                            const on = selSeats[0].companionFor.includes(w.id);
                            return (
                              <label key={w.id} className="check">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() => editSelected((s) => ({ ...s, companionFor: on ? s.companionFor.filter((c) => c !== w.id) : [...s.companionFor, w.id] }))}
                                />
                                {w.id}
                              </label>
                            );
                          })}
                      </div>
                    )}
                  </fieldset>
                )}
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="si-group">Group (sold together)</label>
                    <input
                      id="si-group"
                      maxLength={40}
                      value={cGroup ?? ''}
                      placeholder={cGroup === undefined ? 'Mixed values' : 'None'}
                      onChange={(e) => editSelected((s) => ({ ...s, groupId: e.target.value.trim() || null }))}
                    />
                  </div>
                  <NumField
                    id="si-width"
                    label="Width"
                    step={0.002}
                    min={0.005}
                    value={cWidth ?? selSeats[0].width}
                    onChange={(n) => n > 0 && editSelected((s) => ({ ...s, width: Math.round(n * 1e5) / 1e5 }))}
                    help={cWidth === undefined ? 'Mixed; typing sets all.' : undefined}
                  />
                </div>
                {!readOnly && (
                  <>
                    <div className="quick-actions">
                      <button type="button" className="btn btn-sm" onClick={() => makeGroup(false)} disabled={selSeats.length < 2} title="Selected seats must be booked together">
                        Make pair
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => makeGroup(true)} disabled={selSeats.length < 2}>
                        Make sofa pair
                      </button>
                      <button type="button" className="btn btn-sm" onClick={makeWheelchairPair} disabled={selected.length !== 2} title="First selected seat becomes the wheelchair space, second its companion">
                        Wheelchair + companion
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => editSelected((s) => ({ ...s, groupId: null }))} disabled={!selSeats.some((s) => s.groupId)}>
                        Clear group
                      </button>
                    </div>
                    <p className="help mb-2">Wheelchair + companion uses the first seat you selected as the wheelchair space.</p>
                    <button type="button" className="btn btn-sm btn-danger" onClick={removeSelected}>
                      Delete {selSeats.length === 1 ? 'seat' : `${selSeats.length} seats`}
                    </button>
                  </>
                )}
              </fieldset>
            )}
          </section>

          {!readOnly && (
            <section className="card side-card" aria-labelledby="gen-title">
              <h3 id="gen-title" className="h3">
                Row generator
              </h3>
              <p className="help mb-2">Replaces every seat in the draft with evenly built rows. Fine-tune individual seats afterwards.</p>
              <div className="form-grid">
                <NumField id="g-rows" label="Rows" step={1} min={1} max={24} value={gen.rows} onChange={(n) => setGen({ ...gen, rows: Math.max(1, Math.min(24, Math.round(n))) })} />
                <div className="field">
                  <label htmlFor="g-first">First row</label>
                  <select id="g-first" value={gen.firstRow} onChange={(e) => setGen({ ...gen, firstRow: e.target.value })}>
                    {ROW_LETTERS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <NumField id="g-perblock" label="Seats per block" step={1} min={1} max={40} value={gen.seatsPerBlock} onChange={(n) => setGen({ ...gen, seatsPerBlock: Math.max(1, Math.round(n)) })} />
                <NumField id="g-blocks" label="Blocks" step={1} min={1} max={6} value={gen.blocks} onChange={(n) => setGen({ ...gen, blocks: Math.max(1, Math.min(6, Math.round(n))) })} />
                <NumField id="g-aisle" label="Aisle width (seats)" step={0.25} min={0} value={gen.aisleGap} onChange={(n) => setGen({ ...gen, aisleGap: Math.max(0, n) })} />
                <NumField id="g-size" label="Seat size" step={0.002} min={0.01} max={0.1} value={gen.seatSize} onChange={(n) => n > 0 && setGen({ ...gen, seatSize: n })} />
                <NumField id="g-gap" label="Gap between seats" step={0.001} min={0} value={gen.seatGap} onChange={(n) => setGen({ ...gen, seatGap: Math.max(0, n) })} />
                <NumField id="g-spacing" label="Row spacing" step={0.002} min={0.01} value={gen.rowSpacing} onChange={(n) => n > 0 && setGen({ ...gen, rowSpacing: n })} />
                <NumField id="g-firsty" label="First row position" step={0.01} min={0} value={gen.firstRowY} onChange={(n) => setGen({ ...gen, firstRowY: Math.max(0, n) })} />
                <NumField id="g-curve" label="Curvature" step={0.1} min={0} max={3} value={gen.curvature} onChange={(n) => setGen({ ...gen, curvature: Math.max(0, n) })} help="0 is straight; 0.5 is a gentle arc." />
                <div className="field">
                  <label htmlFor="g-type">Seat type</label>
                  <select
                    id="g-type"
                    value={gen.type}
                    onChange={(e) => {
                      const type = e.target.value as SeatType;
                      const cat = TYPE_TO_CATEGORY[type];
                      setGen({ ...gen, type, priceCategory: cat && knownCat(cat) ? cat : gen.priceCategory });
                    }}
                  >
                    {SEAT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {SEAT_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="g-cat">Price category</label>
                  <select id="g-cat" value={gen.priceCategory} onChange={(e) => setGen({ ...gen, priceCategory: e.target.value })}>
                    {!knownCat(gen.priceCategory) && <option value={gen.priceCategory}>{gen.priceCategory} (unknown)</option>}
                    {catOptions}
                  </select>
                </div>
                <div className="field span-2">
                  <label className="check">
                    <input type="checkbox" checked={gen.stagger} onChange={(e) => setGen({ ...gen, stagger: e.target.checked })} />
                    Stagger alternate rows by half a seat
                  </label>
                </div>
              </div>
              <p className={`help mb-2${rowWidth > 0.96 ? ' text-danger' : ''}`}>
                Each row is {(rowWidth * 100).toFixed(0)}% of the canvas width{rowWidth > 0.96 ? ', which is too wide. Reduce seats or seat size.' : '.'} Sizes are fractions of the canvas width.
              </p>
              <button type="button" className="btn btn-primary" onClick={generate}>
                Generate rows
              </button>
            </section>
          )}

          {!readOnly && (
            <section className="card side-card" aria-labelledby="scr-title">
              <h3 id="scr-title" className="h3">
                Screen and canvas
              </h3>
              <div className="form-grid">
                <NumField id="s-width" label="Screen width" step={0.01} min={0.1} max={1} value={geometry.screen.width} onChange={(n) => n > 0 && edit((l) => ({ ...l, screen: { ...l.screen, width: n } }))} />
                <NumField
                  id="s-curve"
                  label="Screen curvature"
                  step={0.01}
                  min={0}
                  max={0.3}
                  value={geometry.screen.curvature}
                  onChange={(n) => edit((l) => ({ ...l, screen: { ...l.screen, curvature: Math.max(0, Math.min(0.3, n)) } }))}
                />
                <NumField id="s-x" label="Screen centre (across)" step={0.01} min={0} max={1} value={geometry.screen.center.x} onChange={(n) => edit((l) => ({ ...l, screen: { ...l.screen, center: { ...l.screen.center, x: n } } }))} />
                <NumField id="s-y" label="Screen position (down)" step={0.005} min={0} value={geometry.screen.center.y} onChange={(n) => edit((l) => ({ ...l, screen: { ...l.screen, center: { ...l.screen.center, y: n } } }))} />
                <div className="field">
                  <label htmlFor="s-label">Screen label</label>
                  <input id="s-label" maxLength={20} value={geometry.screen.label} onChange={(e) => edit((l) => ({ ...l, screen: { ...l.screen, label: e.target.value } }))} />
                </div>
                <NumField id="s-aspect" label="Canvas aspect ratio" step={0.01} min={0.3} max={3} value={geometry.aspectRatio} onChange={(n) => n > 0 && edit((l) => ({ ...l, aspectRatio: n }))} help="Width divided by height." />
              </div>
              <button type="button" className="btn btn-sm" onClick={() => edit((l) => fitCanvasHeight(l))} disabled={geometry.seats.length === 0}>
                Fit canvas height to seats
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
