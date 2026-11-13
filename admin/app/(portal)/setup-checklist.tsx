'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiKeyRow, Concession, Film, PricingResponse, Release, TeamMember, Venue, VenueAuditoriums, WebhookRow, tenantPath } from '@/lib/api';
import { useSession, useTenantData } from '@/lib/session';

const HIDE_KEY = 'cinema.admin.setupHidden';

interface Step {
  key: string;
  label: string;
  hint: string;
  href: string;
  /** null while loading or when the data can't be read (that step is then left out). */
  done: boolean | null;
}

/**
 * "Get set up": what a new operator still has to do before customers can book, ticked from
 * the operator's real data. A step whose data can't be read is left out rather than guessed.
 */
export function SetupChecklist({ releases }: { releases: Release[] | null }) {
  const { tenant } = useSession();
  const venues = useTenantData<Venue[]>(tenantPath(tenant, '/venues'));
  const screens = useTenantData<VenueAuditoriums[]>(tenantPath(tenant, '/auditoriums'));
  const pricing = useTenantData<PricingResponse>(tenantPath(tenant, '/pricing'));
  const films = useTenantData<Film[]>(tenantPath(tenant, '/films'));
  const food = useTenantData<Concession[]>(tenantPath(tenant, '/concessions'));
  const team = useTenantData<TeamMember[]>(tenantPath(tenant, '/team'));
  const keys = useTenantData<ApiKeyRow[]>(tenantPath(tenant, '/api-keys'));
  const hooks = useTenantData<WebhookRow[]>(tenantPath(tenant, '/webhooks'));

  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(`${HIDE_KEY}.${tenant}`) === '1');
    } catch {
      setHidden(false);
    }
  }, [tenant]);
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(`${HIDE_KEY}.${tenant}`, '1');
    } catch {
      /* storage blocked: hidden for this visit only */
    }
  };

  const read = <T,>(r: { data: T | null; error: string | null }, test: (d: T) => boolean) => (r.error ? null : r.data == null ? null : test(r.data));
  const connected = keys.error || hooks.error || !keys.data || !hooks.data ? null : keys.data.some((k) => !k.revokedAt) || hooks.data.some((h) => h.active);

  const steps: Step[] = [
    { key: 'brand', label: 'Publish your brand', hint: 'Colours, logo and app name', href: '/branding', done: releases ? releases.some((r) => r.status === 'PUBLISHED') : null },
    { key: 'venues', label: 'Add your cinemas', hint: 'Address, opening details, photo', href: '/venues', done: read(venues, (d) => d.length > 0) },
    { key: 'screens', label: 'Publish a seat map', hint: 'At least one screen', href: '/layouts', done: read(screens, (d) => d.some((v) => v.auditoriums.some((a) => a.versions.some((x) => x.status === 'PUBLISHED')))) },
    { key: 'prices', label: 'Set ticket prices', hint: 'Prices for each seat type', href: '/seating', done: read(pricing, (d) => d.ticketTypes.some((t) => Object.values(t.prices).some((p) => typeof p === 'number'))) },
    { key: 'films', label: 'List your films', hint: 'What’s on and coming soon', href: '/films', done: read(films, (d) => d.some((f) => !f.hidden)) },
    { key: 'food', label: 'Add food and drink', hint: 'So customers can order with tickets', href: '/food', done: read(food, (d) => d.length > 0) },
    { key: 'team', label: 'Invite your team', hint: 'Managers and floor staff', href: '/team', done: read(team, (d) => d.length > 1) },
    { key: 'connect', label: 'Connect your systems', hint: 'An API key or webhook', href: '/connections', done: connected },
  ];
  const known = steps.filter((s) => s.done !== null);
  const doneCount = known.filter((s) => s.done).length;
  const loading = known.length < steps.length && [venues, screens, pricing, films, food, team, keys, hooks].some((r) => r.loading);

  if (hidden || loading || known.length === 0 || doneCount === known.length) return null;

  return (
    <section className="card setup" aria-labelledby="setup-title">
      <header className="setup-head">
        <div>
          <h2 id="setup-title" className="h3">
            Get set up
          </h2>
          <p className="muted small">
            {doneCount} of {known.length} done
          </p>
        </div>
        <div className="setup-progress" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={known.length} aria-valuenow={doneCount}>
          <span style={{ width: `${(doneCount / known.length) * 100}%` }} />
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={hide}>
          Hide
        </button>
      </header>
      <ol className="setup-steps">
        {known.map((s) => (
          <li key={s.key} className={s.done ? 'done' : undefined}>
            <Link href={s.href}>
              <span className="setup-dot" aria-hidden="true">
                {s.done ? '✓' : ''}
              </span>
              <span className="setup-text">
                <strong>{s.label}</strong>
                <span className="muted small">{s.done ? 'Done' : s.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
