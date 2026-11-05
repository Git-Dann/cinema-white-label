'use client';

import { FormEvent, useState } from 'react';
import { api, errorMessage, Film, mediaUrl, tenantPath } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useSession, useTenantData } from '@/lib/session';
import { ErrorNote, Loading, PageHeader, SuccessNote } from '@/components/ui';
import { FocalEditor } from '@/components/FocalEditor';
import { SafeImage } from '@/components/SafeImage';

const CERTS = ['U', 'PG', '12A', '12', '15', '18', 'TBC'] as const;

interface FilmForm {
  title: string;
  tagline: string;
  synopsis: string;
  releaseDate: string;
  runtimeMinutes: string;
  certificate: string;
  genres: string;
  director: string;
  cast: string;
}

const toForm = (f: Film): FilmForm => ({
  title: f.title,
  tagline: f.tagline ?? '',
  synopsis: f.synopsis,
  releaseDate: f.releaseDate,
  runtimeMinutes: String(f.runtimeMinutes),
  certificate: f.certificate,
  genres: f.genres.join(', '),
  director: f.director ?? '',
  cast: f.cast.join(', '),
});

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export default function FilmsPage() {
  const { tenant, can } = useSession();
  const films = useTenantData<Film[]>(tenantPath(tenant, '/films'));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [form, setForm] = useState<FilmForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [filter, setFilter] = useState('');

  const selected = films.data?.find((f) => f.id === selectedId) ?? null;
  const asset = selected?.assets.find((a) => a.id === assetId) ?? selected?.assets[0] ?? null;

  function select(f: Film) {
    setSelectedId(f.id);
    setAssetId(f.assets.find((a) => a.kind === 'POSTER' && a.isPreferred)?.id ?? f.assets[0]?.id ?? null);
    setForm(toForm(f));
    setMsg({});
    requestAnimationFrame(() => document.getElementById('film-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!selected || !form) return;
    const runtime = Number(form.runtimeMinutes);
    if (!form.title.trim() || !form.synopsis.trim()) return setMsg({ error: 'Title and synopsis are required.' });
    if (!Number.isInteger(runtime) || runtime <= 0) return setMsg({ error: 'Running time must be a whole number of minutes.' });
    setBusy(true);
    setMsg({});
    try {
      await api(tenantPath(tenant, `/films/${selected.id}`), {
        method: 'PUT',
        body: {
          title: form.title.trim(),
          tagline: form.tagline.trim() || null,
          synopsis: form.synopsis.trim(),
          releaseDate: form.releaseDate,
          runtimeMinutes: runtime,
          certificate: form.certificate,
          genres: list(form.genres),
          director: form.director.trim() || null,
          cast: list(form.cast),
        },
      });
      setMsg({ ok: `${form.title.trim()} saved. Manual edits are protected from provider syncs.` });
      films.reload();
    } catch (err) {
      setMsg({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof FilmForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  const visible = (films.data ?? []).filter((f) => !filter || f.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <PageHeader title="Films" description="Edit listings and choose how artwork is cropped in the app." />
      <ErrorNote message={films.error} />

      {selected && form && (
        <section id="film-editor" className="card film-editor" aria-labelledby="film-editor-title">
          <div className="row between">
            <h2 id="film-editor-title" className="h3">
              {selected.title}
            </h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>
          <div className="film-editor-grid">
            <form onSubmit={save} noValidate>
              <fieldset disabled={!can.canEditContent} className="plain">
                <div className="form-grid">
                  <div className="field span-2">
                    <label htmlFor="f-title">Title</label>
                    <input id="f-title" value={form.title} onChange={set('title')} required />
                  </div>
                  <div className="field span-2">
                    <label htmlFor="f-tagline">Tagline</label>
                    <input id="f-tagline" value={form.tagline} onChange={set('tagline')} />
                  </div>
                  <div className="field span-2">
                    <label htmlFor="f-synopsis">Synopsis</label>
                    <textarea id="f-synopsis" rows={4} value={form.synopsis} onChange={set('synopsis')} required />
                  </div>
                  <div className="field">
                    <label htmlFor="f-release">Release date</label>
                    <input id="f-release" type="date" value={form.releaseDate} onChange={set('releaseDate')} required />
                  </div>
                  <div className="field">
                    <label htmlFor="f-runtime">Running time (minutes)</label>
                    <input id="f-runtime" inputMode="numeric" value={form.runtimeMinutes} onChange={set('runtimeMinutes')} required />
                  </div>
                  <div className="field">
                    <label htmlFor="f-cert">BBFC certificate</label>
                    <select id="f-cert" value={form.certificate} onChange={set('certificate')}>
                      {CERTS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="f-director">Director</label>
                    <input id="f-director" value={form.director} onChange={set('director')} />
                  </div>
                  <div className="field span-2">
                    <label htmlFor="f-genres">Genres</label>
                    <input id="f-genres" value={form.genres} onChange={set('genres')} aria-describedby="f-genres-help" />
                    <p id="f-genres-help" className="help">
                      Separate with commas.
                    </p>
                  </div>
                  <div className="field span-2">
                    <label htmlFor="f-cast">Cast</label>
                    <input id="f-cast" value={form.cast} onChange={set('cast')} aria-describedby="f-cast-help" />
                    <p id="f-cast-help" className="help">
                      Separate with commas.
                    </p>
                  </div>
                </div>
              </fieldset>
              <ErrorNote message={msg.error} />
              <SuccessNote message={msg.ok} />
              {can.canEditContent && (
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save film'}
                </button>
              )}
            </form>

            <div className="asset-panel">
              <h3 className="h4">Artwork</h3>
              {selected.assets.length === 0 ? (
                <p className="muted">No artwork for this film.</p>
              ) : (
                <>
                  <div className="asset-thumbs" role="radiogroup" aria-label="Choose image">
                    {selected.assets.map((a) => (
                      <button
                        key={a.id}
                        role="radio"
                        aria-checked={asset?.id === a.id}
                        className={`asset-thumb${asset?.id === a.id ? ' selected' : ''}`}
                        onClick={() => setAssetId(a.id)}
                        aria-label={`${a.kind.toLowerCase()} ${a.width}×${a.height}${a.isPreferred ? ', preferred' : ''}`}
                      >
                        <SafeImage src={mediaUrl(a.url, 160)} alt="" fallback={<span className="thumb-fallback" />} />
                        <span>
                          {a.kind.toLowerCase()}
                          {a.isPreferred ? ' · preferred' : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                  {asset && <FocalEditor tenant={tenant} asset={asset} canEdit={can.canEditContent} onSaved={films.reload} />}
                </>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="row between mb-2">
        <div className="field compact inline-field">
          <label htmlFor="film-filter">Search films</label>
          <input id="film-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Title" />
        </div>
        {films.data && (
          <span className="muted small">
            {visible.length} of {films.data.length}
          </span>
        )}
      </div>
      {films.loading && !films.data && <Loading />}
      <ul className="film-grid">
        {visible.map((f) => (
          <li key={f.id}>
            <button className={`film-card${selectedId === f.id ? ' selected' : ''}`} onClick={() => select(f)} aria-label={`Edit ${f.title}`}>
              <div className="film-poster" style={{ background: f.poster?.dominantColor ?? 'var(--surface-2)' }}>
                <SafeImage
                  src={f.poster ? mediaUrl(f.poster.url, 342) : null}
                  alt=""
                  loading="lazy"
                  style={f.poster ? { objectPosition: `${f.poster.focalPoint.x * 100}% ${f.poster.focalPoint.y * 100}%` } : undefined}
                  fallback={<span className="poster-fallback">{f.title}</span>}
                />
              </div>
              <div className="film-meta">
                <div className="film-title">{f.title}</div>
                <div className="muted small">
                  <span className="cert">{f.certificate}</span> {f.runtimeMinutes} min · {f.status === 'nowShowing' ? 'Now showing' : `From ${formatDate(f.releaseDate)}`}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
