'use client';

import { FormEvent, useState } from 'react';
import { ApiErrorNote, ErrorNote, Loading, PageHeader, ReadOnlyNote, SuccessNote } from '@/components/ui';
import { api, errorDetails, errorMessage, Role, TeamMember, tenantPath } from '@/lib/api';
import { formatDate, roleLabel } from '@/lib/format';
import { useSession, useTenantData } from '@/lib/session';

/*
 * Team & roles: who can sign in to the portal, and what each role sees. Operator
 * admins add people (with a temporary password shown once), change roles and remove
 * access. The server keeps at least one operator admin and never lets you lock yourself out.
 */

type ApiErr = { message: string; details: string[] } | null;
const ROLES: { role: Role; summary: string; sees: string }[] = [
  { role: 'OPERATOR_ADMIN', summary: 'Runs the whole operator', sees: 'Everything, including prices, vouchers, publishing and the team' },
  { role: 'VENUE_MANAGER', summary: 'Runs a cinema day to day', sees: 'Today, Next 6 weeks, films, screens, seats and food' },
  { role: 'CONTENT_EDITOR', summary: 'Looks after the app', sees: 'Films, branding, offers and food, without prices or the team' },
  { role: 'REPORTING', summary: 'Reads the numbers', sees: 'Overview, Insights and planning, read only' },
];

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');

export default function TeamPage() {
  const { tenant, me, can } = useSession();
  const team = useTenantData<TeamMember[]>(tenantPath(tenant, '/team'));
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'VENUE_MANAGER' as Role });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<ApiErr>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const members = team.data ?? [];

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const r = await api<{ member: TeamMember; temporaryPassword: string }>(tenantPath(tenant, '/team'), { method: 'POST', body: form });
      setCreated({ name: r.member.name, email: r.member.email, password: r.temporaryPassword });
      setForm({ name: '', email: '', role: 'VENUE_MANAGER' });
      setAdding(false);
      team.reload();
    } catch (err) {
      setFormError({ message: errorMessage(err), details: errorDetails(err) });
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(m: TeamMember, role: Role) {
    setError(null);
    setSaved(null);
    try {
      await api(tenantPath(tenant, `/team/${m.id}`), { method: 'PUT', body: { role } });
      setSaved(`${m.name} is now ${roleLabel(role).toLowerCase()}.`);
      team.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(m: TeamMember) {
    if (!window.confirm(`Remove ${m.name}'s access to the portal?`)) return;
    setError(null);
    setSaved(null);
    try {
      await api(tenantPath(tenant, `/team/${m.id}`), { method: 'DELETE' });
      setSaved(`${m.name} no longer has access.`);
      team.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Team & roles"
        description="Who can sign in, and what each role sees"
        actions={can.canManageTeam && !adding ? <button className="btn btn-primary" onClick={() => { setAdding(true); setCreated(null); }}>Add person</button> : null}
      />
      {!can.canManageTeam && <ReadOnlyNote>Only operator admins can add people or change roles.</ReadOnlyNote>}

      <ul className="tile-grid role-grid" aria-label="Roles">
        {ROLES.map((r) => {
          const n = members.filter((m) => m.role === r.role).length;
          return (
            <li key={r.role} className="card tile">
              <div className="tile-head">
                <div className="tile-title">{roleLabel(r.role)}</div>
                <span className="badge badge-neutral">{n} {n === 1 ? 'person' : 'people'}</span>
              </div>
              <div className="small">{r.summary}</div>
              <div className="muted small">Sees: {r.sees}</div>
            </li>
          );
        })}
      </ul>

      {created && (
        <div className="card team-created" role="status">
          <strong>{created.name} can now sign in.</strong>
          <p className="small">
            Send them <span className="num">{created.email}</span> and this temporary password. It is shown once, so copy it now.
          </p>
          <div className="team-password">
            <code>{created.password}</code>
            <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(created.password)}>Copy</button>
          </div>
        </div>
      )}

      {adding && (
        <form className="card team-form" onSubmit={add} aria-labelledby="team-add">
          <h2 id="team-add" className="h3">Add a person</h2>
          <ApiErrorNote error={formError} />
          <div className="form-grid cols-3">
            <div className="field">
              <label htmlFor="t-name">Name</label>
              <input id="t-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="t-email">Email</label>
              <input id="t-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="t-role">Role</label>
              <select id="t-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r.role} value={r.role}>{roleLabel(r.role)}</option>)}
              </select>
            </div>
          </div>
          <div className="row gap-1">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add and create password'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}

      <ErrorNote message={error ?? team.error} />
      <SuccessNote message={saved} />
      <h2 className="h3 section-title">People</h2>
      {team.loading && !team.data ? (
        <Loading />
      ) : (
        <ul className="tile-grid" aria-label="People">
          {members.map((m) => {
            const you = m.email === me.email;
            return (
              <li key={m.id} className="card tile">
                <div className="team-person">
                  <span className="team-avatar" aria-hidden="true">{initials(m.name)}</span>
                  <div className="team-who">
                    <div className="tile-title">{m.name}{you && <span className="muted small"> · you</span>}</div>
                    <div className="muted small team-email">{m.email}</div>
                  </div>
                </div>
                <div className="muted small">Added {formatDate(m.createdAt)}</div>
                {can.canManageTeam && !you ? (
                  <div className="tile-actions">
                    <label className="visually-hidden" htmlFor={`role-${m.id}`}>Role for {m.name}</label>
                    <select id={`role-${m.id}`} value={m.role} onChange={(e) => changeRole(m, e.target.value as Role)}>
                      {ROLES.map((r) => <option key={r.role} value={r.role}>{roleLabel(r.role)}</option>)}
                    </select>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(m)}>Remove</button>
                  </div>
                ) : (
                  <div className="tile-actions"><span className="badge">{roleLabel(m.role)}</span></div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
