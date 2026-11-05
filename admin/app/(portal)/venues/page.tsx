'use client';

import { FormEvent, useState } from 'react';
import { api, errorMessage, tenantPath, Venue } from '@/lib/api';
import { useSession, useTenantData } from '@/lib/session';
import { ErrorNote, Loading, PageHeader, SuccessNote } from '@/components/ui';

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
}

const EMPTY: VenueForm = { slug: '', name: '', addressLine1: '', city: '', postcode: '', latitude: '', longitude: '', phone: '', facilities: '' };

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
  };
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export default function VenuesPage() {
  const { tenant, can } = useSession();
  const venues = useTenantData<Venue[]>(tenantPath(tenant, '/venues'));
  const [editing, setEditing] = useState<Venue | 'new' | null>(null);
  const [form, setForm] = useState<VenueForm>(EMPTY);
  const [busy, setBusy] = useState(false);
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!form.name.trim() || !form.addressLine1.trim() || !form.city.trim() || form.postcode.trim().length < 2) {
      return setFormError('Name, address, city and postcode are required.');
    }
    if (!/^[a-z0-9-]+$/.test(form.slug)) return setFormError('Slug may contain only lowercase letters, numbers and hyphens.');
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
    };
    setBusy(true);
    setFormError(null);
    try {
      if (editing === 'new') {
        await api(tenantPath(tenant, '/venues'), { method: 'POST', body });
        setMsg({ ok: `${body.name} created.` });
      } else if (editing) {
        await api(tenantPath(tenant, `/venues/${editing.id}`), { method: 'PUT', body });
        setMsg({ ok: `${body.name} updated.` });
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
    setMsg({});
    try {
      await api(tenantPath(tenant, `/venues/${v.id}`), { method: 'DELETE' });
      setMsg({ ok: `${v.name} deleted.` });
      if (editing !== 'new' && editing?.id === v.id) setEditing(null);
      venues.reload();
    } catch (err) {
      setMsg({ error: errorMessage(err) });
    }
  }

  const set = (k: keyof VenueForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

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

      {editing && (
        <section className="card" aria-labelledby="venue-form-title">
          <h2 id="venue-form-title" className="h3">
            {editing === 'new' ? 'New cinema' : `Edit ${editing.name}`}
          </h2>
          <form onSubmit={submit} noValidate>
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
                <label htmlFor="v-slug">Slug</label>
                <input id="v-slug" value={form.slug} required onChange={set('slug')} aria-describedby="v-slug-help" />
                <p id="v-slug-help" className="help">
                  Used in links. Lowercase letters, numbers and hyphens.
                </p>
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
                <p id="v-fac-help" className="help">
                  Separate with commas, e.g. Wheelchair access, Hearing loop
                </p>
              </div>
            </div>
            <ErrorNote message={formError} />
            <div className="row gap-1">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editing === 'new' ? 'Create cinema' : 'Save changes'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card" aria-label="Cinemas list">
        {venues.loading && !venues.data && <Loading />}
        {venues.data && venues.data.length === 0 && <p className="muted">No cinemas yet.</p>}
        {venues.data && venues.data.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Address</th>
                  <th scope="col">Screens</th>
                  <th scope="col">Facilities</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {venues.data.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <div className="strong">{v.name}</div>
                      <div className="muted small">{v.slug}</div>
                    </td>
                    <td>
                      {v.address.line1}, {v.address.city} {v.address.postcode}
                    </td>
                    <td className="num">{v.screenCount ?? '—'}</td>
                    <td className="small">{v.facilities.join(', ') || <span className="muted">—</span>}</td>
                    <td className="actions">
                      {can.canEditVenues && (
                        <button className="btn btn-sm" onClick={() => startEdit(v)} aria-label={`Edit ${v.name}`}>
                          Edit
                        </button>
                      )}
                      {can.canDeleteVenues && (
                        <button className="btn btn-sm btn-danger" onClick={() => remove(v)} aria-label={`Delete ${v.name}`}>
                          Delete
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
    </>
  );
}
