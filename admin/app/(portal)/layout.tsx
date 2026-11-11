'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SessionProvider, useSession } from '@/lib/session';
import { roleLabel } from '@/lib/format';
import { CinemaScopeProvider, useCinemaScope } from '@/lib/cinema-scope';
import { HOME, useViewAs, VIEW_LABELS, ViewAsProvider, type ViewAs } from '@/lib/view-as';

const H: ViewAs[] = ['head-office'];
const HV: ViewAs[] = ['head-office', 'venue'];

interface NavItem { href: string; label: string; views: ViewAs[] }
/**
 * The menu, grouped by the job people come to do. Each role sees only its groups;
 * labels say what's on the page in plain words (URLs stay as they were).
 */
const NAV: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [
    { href: '/', label: 'Overview', views: H },
    { href: '/today', label: 'Today', views: ['venue'] },
    { href: '/my-week', label: 'My week', views: ['floor'] },
  ] },
  { group: 'Plan', items: [
    { href: '/insights', label: 'Insights', views: H },
    { href: '/year-ahead', label: 'Year ahead ✦', views: H },
    { href: '/next-weeks', label: 'Next 6 weeks ✦', views: HV },
  ] },
  { group: 'What’s on', items: [
    { href: '/films', label: 'Films', views: HV },
    { href: '/venues', label: 'Cinemas', views: HV },
    { href: '/layouts', label: 'Screens & seat maps', views: HV },
    { href: '/seating', label: 'Seats & ticket prices', views: HV },
  ] },
  { group: 'Sell', items: [
    { href: '/food', label: 'Food & drink', views: HV },
    { href: '/promotions', label: 'Offers', views: H },
    { href: '/vouchers', label: 'Vouchers', views: H },
    { href: '/loyalty', label: 'Loyalty & memberships', views: H },
  ] },
  { group: 'Your app', items: [
    { href: '/branding', label: 'Branding & theme', views: H },
    { href: '/releases', label: 'Releases', views: H },
  ] },
  { group: 'Team', items: [{ href: '/team', label: 'Team & roles', views: H }] },
];


const isActive = (href: string, pathname: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, tenant, setTenant, signOut } = useSession();
  const { view } = useViewAs();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((n) => n.views.includes(view)) })).filter((g) => g.items.length);
  const allowed = groups.flatMap((g) => g.items);
  // A page this view doesn't have (a typed URL, a bookmark, a view switch) goes to the view's home.
  const blocked = !allowed.some((n) => isActive(n.href, pathname));
  useEffect(() => {
    if (blocked) router.replace(HOME[view]);
  }, [blocked, view, router]);
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small" aria-hidden="true">
            <span />
          </div>
          <div>
            <div className="sidebar-title">Seatfold</div>
            <div className="sidebar-sub">{me.tenants.length === 1 ? me.tenants[0]?.name : 'Operator portal'}</div>
          </div>
        </div>

        {me.tenants.length > 1 && (
          <div className="field compact">
            <label htmlFor="tenant-switch">Operator</label>
            <select id="tenant-switch" value={tenant} onChange={(e) => setTenant(e.target.value)}>
              {me.tenants.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <CinemaSwitch />
        <ViewSwitch />

        <nav aria-label="Main">
          {groups.map((g) => (
            <div key={g.group ?? 'home'} className="nav-group">
              {g.group && <div className="nav-group-label">{g.group}</div>}
              <ul className="nav">
                {g.items.map((n) => {
                  const active = isActive(n.href, pathname);
                  return (
                    <li key={n.href}>
                      <Link href={n.href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
                        {n.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="sidebar-user">
          <div className="sidebar-user-text">
            <div className="user-name">{me.name}</div>
            <div className="user-meta">{roleLabel(me.role)}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      {/* Re-mount pages on tenant change so they reload their data cleanly. */}
      <main id="main" className="main" key={tenant} tabIndex={-1}>
        {/* Never flash a page this view can't see while the redirect happens. */}
        {blocked ? null : children}
      </main>
    </div>
  );
}

function CinemaSwitch() {
  const { venues, venueId, setVenueId } = useCinemaScope();
  if (venues.length < 2) return null;
  return (
    <div className="field compact">
      <label htmlFor="cinema-switch">Cinema</label>
      <select id="cinema-switch" value={venueId ?? ''} onChange={(e) => setVenueId(e.target.value || null)}>
        <option value="">All cinemas</option>
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ViewSwitch() {
  const { view, views, setView } = useViewAs();
  if (views.length < 2) return null;
  return (
    <div className="field compact view-switch">
      <label htmlFor="view-switch">
        Preview as <span className="badge badge-sample">Demo</span>
      </label>
      <select id="view-switch" value={view} onChange={(e) => setView(e.target.value as ViewAs)}>
        {views.map((v) => (
          <option key={v} value={v}>
            {VIEW_LABELS[v]}
          </option>
        ))}
      </select>
    </div>
  );
}

function ScopedShell({ children }: { children: React.ReactNode }) {
  const { tenant } = useSession();
  // Keyed by operator so the cinema choice reloads with the operator's venues.
  return (
    <CinemaScopeProvider key={tenant}>
      <ViewAsProvider>
        <Shell>{children}</Shell>
      </ViewAsProvider>
    </CinemaScopeProvider>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ScopedShell>{children}</ScopedShell>
    </SessionProvider>
  );
}
