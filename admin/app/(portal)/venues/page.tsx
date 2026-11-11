'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCinemaScope } from '@/lib/cinema-scope';
import { api, errorMessage, mediaUrl, tenantPath, Venue } from '@/lib/api';
import { MAX_UPLOAD_BYTES, readFileBase64 } from '@/lib/files';
import { useSession, useTenantData } from '@/lib/session';
import { useViewAs } from '@/lib/view-as';
import { ErrorNote, Loading, PageHeader, SuccessNote } from '@/components/ui';
import { SafeImage } from '@/components/SafeImage';
import { Sheet, TileHit } from '@/components/Sheet';

/*
 * Cinemas: a photo card per venue. Clicking a card opens it in the edit panel, where
 * the photo, address and facilities change and the cinema can be deleted.
 */

interface VenueForm {
  slug: string;
  name: string;
  addressLine1: string;
  city: string;
  postcode: string;
  latitude: string;
  longitude: string;
  phone: string;
  facilities: string;
  imageAssetId: string | null;
  imageUrl: string | null;
}

const EMPTY: VenueForm = { slug: '', name: '', addressLine1: '', city: '', postcode: '', latitude: '', longitude: '', phone: '', facilities: '', imageAssetId: null, imageUrl: null };

function toForm(v: Venue): VenueForm {
  return {
    slug: v.slug,
    name: v.name,
    addressLine1: v.address.line1,
    city: v.address.city,
    postcode: v.address.postcode,
    latitude: String(v.coordinate.latitude),
    longitude: String(v.coordinate.longitude),
    phone: v.phone ?? '',
    facilities: v.facilities.join(', '),
    imageAssetId: v.image?.id ?? null,
    imageUrl: v.image?.url ?? null,
  };
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function PhotoPlaceholder({ name }: { name: string }) {
  return (
    <span className="venue-photo-empty" aria-hidden="true">
      {name.replace(/^\S+\s/, '').slice(0, 1) || '?'}
    </span>
  );
}

export default function VenuesPage() {
  const router = useRouter();
  const scope = useCinemaScope();
  const { view } = useViewAs();
  const { tenant, can } = useSession();
  const venues = useTenantData<Venue[]>(tenantPath(tenant, '/venues'));
  const [editing, setEditing] = useState<Venue | 'new' | null>(null);
  const [form, setForm] = useState<VenueForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  function startNew() {
    setEditing('new');
    setForm(EMPTY);
    setFormError(null);
    setMsg({});
  }
  function startEdit(v: Venue) {
    setEditing(v);
    setForm(toForm(v));
    setFormError(null);
    setMsg({});
  }
  const close = () => setEditing(null);

  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setFormError('Choose a JPEG, PNG or WebP image.');
    if (file.size > MAX_UPLOAD_BYTES) return setFormError('That image is over 10 MB. Choose a smaller one.');
    setUploading(true);
    setFormError(null);
    try {
      const res = await api<{ id: string; url: string }>(tenantPath(tenant, '/media'), { method: 'POST', body: { kind: 'VENUE', dataBase64: await readFileBase64(file) } });
      setForm((f) => ({ ...f, imageAssetId: res.id, imageUrl: res.url }));
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!form.name.trim() || !form.addressLine1.trim() || !form.city.trim() || form.postcode.trim().length < 2) {
      return setFormError('Name, address, town and postcode are required.');
    }
    if (!/^[a-z0-9-]+$/.test(form.slug)) return setFormError('The link name may contain only lowercase letters, numbers and hyphens.');
    if (form.latitude === '' || form.longitude === '' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return setFormError('Enter a valid latitude (−90 to 90) and longitude (−180 to 180).');
    }
    const body = {
      slug: form.slug,
      name: form.name.trim(),
      addressLine1: form.addressLine1.trim(),
      city: form.city.trim(),
      postcode: form.postcode.trim().toUpperCase(),
      latitude: lat,
      longitude: lng,
      phone: form.phone.trim() || null,
      facilities: form.facilities
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean),
      imageAssetId: form.imageAssetId,
    };
    setBusy(true);
    setFormError(null);
    try {
      if (editing === 'new') {
        await api(tenantPath(tenant, '/venues'), { method: 'POST', body });
        setMsg({ ok: `${body.name} added.` });
      } else if (editing) {
        await api(tenantPath(tenant, `/venues/${editing.id}`), { method: 'PUT', body });
        setMsg({ ok: `${body.name} saved.` });
      }
      setEditing(null);
      venues.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(v: Venue) {
    if (!window.confirm(`Delete ${v.name}? This cannot be undone.`)) return;
    setFormError(null);
    try {
      await api(tenantPath(tenant, `/venues/${v.id}`), { method: 'DELETE' });
      setMsg({ ok: `${v.name} deleted.` });
      setEditing(null);
      venues.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  }

  const goTo = (v: Venue, path: string) => {
    scope.setVenueId(v.id);
    router.push(path);
  };
  const set = (k: keyof VenueForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const current = editing && editing !== 'new' ? editing : null;

  return (
    <>
      <PageHeader
        title="Cinemas"
        description="Venues shown in the app’s cinema finder."
        actions={
          can.canEditVenues && (
            <button className="btn btn-primary" onClick={startNew}>
              Add cinema
            </button>
          )
        }
      />
      <ErrorNote message={msg.error ?? venues.error} />
      <SuccessNote message={msg.ok} />

      <Sheet
        open={!!editing}
        title={current ? current.name : 'New cinema'}
        subtitle={
          current ? (
            <>
              {view === 'venue' && (
                <>
                  <button type="button" className="link-btn" onClick={() => goTo(current, '/today')}>Today</button>
                  {' · '}
                </>
              )}
              <button type="button" className="link-btn" onClick={() => goTo(current, '/layouts')}>Screens & seat maps</button>
            </>
          ) : undefined
        }
        onClose={close}
        onSubmit={submit}
        footer={
          <>
            <button type="submit" className="btn btn-primary" disabled={busy || uploading}>
              {busy ? 'Saving…' : current ? 'Save changes' : 'Add cinema'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            {current && can.canDeleteVenues && (
              <button type="button" className="btn btn-danger sheet-foot-end" onClick={() => remove(current)}>
                Delete cinema
              </button>
            )}
          </>
        }
      >
        <div className="image-field">
          <div className="image-field-preview">
            <SafeImage src={mediaUrl(form.imageUrl, 780)} alt="" fallback={<PhotoPlaceholder name={form.name || 'New cinema'} />} />
          </div>
          <div className="image-field-side">
            <div className="label">Photo</div>
            <p className="help">Shown on the cinema’s card here and in the app. Landscape works best, around 1200 × 900. JPEG, PNG or WebP up to 10 MB.</p>
            <div className="row gap-1 mt-2">
              <label className={`btn btn-sm file-btn${uploading ? ' disabled' : ''}`}>
                {uploading ? 'Uploading…' : form.imageAssetId ? 'Replace photo' : 'Upload photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" disabled={uploading} onChange={(e) => uploadPhoto(e.target.files?.[0])} />
              </label>
              {form.imageAssetId && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm({ ...form, imageAssetId: null, imageUrl: null })}>
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="v-name">Name</label>
            <input
              id="v-name"
              value={form.name}
              required
              onChange={(e) => {
                const name = e.target.value;
                setForm((f) => ({ ...f, name, slug: editing === 'new' && (f.slug === '' || f.slug === slugify(f.name)) ? slugify(name) : f.slug }));
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="v-slug">Link name</label>
            <input id="v-slug" value={form.slug} required onChange={set('slug')} aria-describedby="v-slug-help" />
            <p id="v-slug-help" className="help">Used in links. Lowercase letters, numbers and hyphens.</p>
          </div>
          <div className="field span-2">
            <label htmlFor="v-addr">Address</label>
            <input id="v-addr" value={form.addressLine1} required onChange={set('addressLine1')} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="v-city">Town or city</label>
            <input id="v-city" value={form.city} required onChange={set('city')} />
          </div>
          <div className="field">
            <label htmlFor="v-postcode">Postcode</label>
            <input id="v-postcode" value={form.postcode} required onChange={set('postcode')} />
          </div>
          <div className="field">
            <label htmlFor="v-lat">Latitude</label>
            <input id="v-lat" inputMode="decimal" value={form.latitude} required onChange={set('latitude')} />
          </div>
          <div className="field">
            <label htmlFor="v-lng">Longitude</label>
            <input id="v-lng" inputMode="decimal" value={form.longitude} required onChange={set('longitude')} />
          </div>
          <div className="field">
            <label htmlFor="v-phone">Phone (optional)</label>
            <input id="v-phone" type="tel" value={form.phone} onChange={set('phone')} />
          </div>
          <div className="field">
            <label htmlFor="v-fac">Facilities</label>
            <input id="v-fac" value={form.facilities} onChange={set('facilities')} aria-describedby="v-fac-help" />
            <p id="v-fac-help" className="help">Separate with commas, e.g. Wheelchair access, Hearing loop</p>
          </div>
        </div>
        <ErrorNote message={formError} />
      </Sheet>

      <section aria-label="Cinemas">
        {venues.loading && !venues.data && <Loading />}
        {venues.data && venues.data.length === 0 && <p className="muted">No cinemas yet. Add your first one.</p>}
        {venues.data && venues.data.length > 0 && (
          <ul className="tile-grid venue-grid">
            {venues.data.map((v) => (
              <li key={v.id} className={`card venue-card${can.canEditVenues ? ' tile-click' : ''}`}>
                {can.canEditVenues && <TileHit label={`Edit ${v.name}`} onClick={() => startEdit(v)} />}
                <div className="venue-photo" style={{ background: v.image?.dominantColor ?? undefined }}>
                  <SafeImage src={mediaUrl(v.image?.url, 780)} alt="" loading="lazy" fallback={<PhotoPlaceholder name={v.name} />} />
                  <span className="venue-photo-screens">
                    <strong className="num">{v.screenCount ?? '–'}</strong> {v.screenCount === 1 ? 'screen' : 'screens'}
                  </span>
                </div>
                <div className="venue-body">
                  <div className="tile-title">{v.name}</div>
                  <div className="muted small">
                    {v.address.line1}, {v.address.city} {v.address.postcode}
                  </div>
                  {v.facilities.length > 0 && (
                    <ul className="tag-list" aria-label="Facilities">
                      {v.facilities.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
