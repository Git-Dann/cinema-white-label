'use client';

import { KeyboardEvent, MouseEvent, useEffect, useState } from 'react';
import { api, errorMessage, FilmAsset, mediaUrl, tenantPath } from '@/lib/api';
import { ErrorNote, SuccessNote } from './ui';
import { SafeImage } from './SafeImage';

const CROPS = [
  { label: '2:3 poster', ratio: '2 / 3', width: 96 },
  { label: '16:9 banner', ratio: '16 / 9', width: 192 },
  { label: '1:1 tile', ratio: '1 / 1', width: 108 },
];

const clamp = (n: number) => Math.max(0, Math.min(1, n));

export function FocalEditor({ tenant, asset, canEdit, onSaved }: { tenant: string; asset: FilmAsset; canEdit: boolean; onSaved: () => void }) {
  const [focal, setFocal] = useState({ x: asset.focalX, y: asset.focalY });
  const [preferred, setPreferred] = useState(asset.isPreferred);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  useEffect(() => {
    setFocal({ x: asset.focalX, y: asset.focalY });
    setPreferred(asset.isPreferred);
    setMsg({});
  }, [asset.id, asset.focalX, asset.focalY, asset.isPreferred]);

  const src = mediaUrl(asset.url, 780)!;
  const pos = `${(focal.x * 100).toFixed(1)}% ${(focal.y * 100).toFixed(1)}%`;
  const changed = focal.x !== asset.focalX || focal.y !== asset.focalY || preferred !== asset.isPreferred;

  function onClick(e: MouseEvent<HTMLDivElement>) {
    if (!canEdit) return;
    const r = e.currentTarget.getBoundingClientRect();
    setFocal({ x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) });
    setMsg({});
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!canEdit) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key in d) {
      e.preventDefault();
      const [dx, dy] = d[e.key];
      setFocal((f) => ({ x: clamp(Math.round((f.x + dx) * 100) / 100), y: clamp(Math.round((f.y + dy) * 100) / 100) }));
      setMsg({});
    }
  }

  async function save() {
    setBusy(true);
    setMsg({});
    try {
      await api(tenantPath(tenant, `/assets/${asset.id}`), {
        method: 'PUT',
        body: { focalX: Math.round(focal.x * 1000) / 1000, focalY: Math.round(focal.y * 1000) / 1000, isPreferred: preferred },
      });
      setMsg({ ok: 'Focal point saved.' });
      onSaved();
    } catch (e) {
      setMsg({ error: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="focal">
      <div className="focal-main">
        <div
          className={`focal-image${canEdit ? ' editable' : ''}`}
          onClick={onClick}
          onKeyDown={onKey}
          tabIndex={canEdit ? 0 : -1}
          role="application"
          aria-label={`Focal point editor. Current point ${Math.round(focal.x * 100)}% across, ${Math.round(focal.y * 100)}% down. Click the image or use arrow keys to move it; hold Shift for larger steps.`}
          style={{ aspectRatio: `${asset.width} / ${asset.height}`, width: `min(100%, ${Math.round((360 * asset.width) / asset.height)}px)` }}
        >
          <SafeImage src={src} alt="" draggable={false} fallback={<span className="image-fallback">Image unavailable. Try again shortly.</span>} />
          <span className="crosshair" style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }} aria-hidden="true" />
        </div>
        <p className="help">
          {asset.kind.toLowerCase()} · {asset.width}×{asset.height} · focal {focal.x.toFixed(2)}, {focal.y.toFixed(2)}
        </p>
      </div>
      <div className="focal-side">
        <div className="label">Crop previews</div>
        <div className="crops">
          {CROPS.map((c) => (
            <figure key={c.label} className="crop">
              <div className="crop-frame" style={{ aspectRatio: c.ratio, width: c.width }}>
                <SafeImage src={src} alt="" style={{ objectPosition: pos }} />
              </div>
              <figcaption>{c.label}</figcaption>
            </figure>
          ))}
        </div>
        {canEdit && (
          <>
            <label className="check mt-2">
              <input type="checkbox" checked={preferred} onChange={(e) => setPreferred(e.target.checked)} />
              Preferred {asset.kind.toLowerCase()} for this film
            </label>
            <ErrorNote message={msg.error} />
            <SuccessNote message={msg.ok} />
            <div className="row gap-1 mt-2">
              <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !changed}>
                {busy ? 'Saving…' : 'Save focal point'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setFocal({ x: asset.focalX, y: asset.focalY })} disabled={!changed || busy}>
                Reset
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
