'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SessionProvider, useSession } from '@/lib/session';
import { roleLabel } from '@/lib/format';
import { CinemaScopeProvider, useCinemaScope } from '@/lib/cinema-scope';
import { useViewAs, VIEW_LABELS, ViewAsProvider, type ViewAs } from '@/lib/view-as';

const H: ViewAs[] = ['head-office'];
const HV: ViewAs[] = ['head-office', 'venue'];
const NAV: { href: string; label: string; views: ViewAs[] }[] = [
  { href: '/', label: 'Overview', views: HV },
  { href: '/insights', label: 'Insights', views: H },
  { href: '/year-ahead', label: 'Year ahead ✦', views: H },
  { href: '/next-weeks', label: 'Next 6 weeks ✦', views: HV },
  { href: '/my-week', label: 'My week', views: ['floor'] },
  { href: '/branding', label: 'Branding & theme', views: H },
  { href: '/releases', label: 'Releases', views: H },
  { href: '/venues', label: 'Cinemas', views: HV },
  { href: '/layouts', label: 'Auditorium layouts', views: HV },
  { href: '/seating', label: 'Seat categories & pricing', views: HV },
  { href: '/food', label: 'Food & drink', views: HV },
  { href: '/vouchers', label: 'Vouchers', views: H },
  { href: '/promotions', label: 'Promotions', views: H },
  { href: '/loyalty', label: 'Loyalty & memberships', views: H },
  { href: '/films', label: 'Films', views: H },
];

const isActive = (href: string, pathname: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, tenant, setTenant, signOut } = useSession();
  const { view } = useViewAs();
  const nav = NAV.filter((n) => n.views.includes(view));
  // Switching view moves off a page that view does not have.
  useEffect(() => {
    if (!nav.some((n) => isActive(n.href, pathname))) router.replace(nav[0].href);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
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
            <div className="sidebar-title">Operator Portal</div>
            <div className="sidebar-sub">White-label cinema</div>
          </div>
        </div>

        <div className="field compact">
          <label htmlFor="tenant-switch">Operator</label>
          {me.tenants.length > 1 ? (
            <select id="tenant-switch" value={tenant} onChange={(e) => setTenant(e.target.value)}>
              {me.tenants.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <div id="tenant-switch" className="tenant-static">
              {me.tenants[0]?.name}
            </div>
          )}
        </div>

        <CinemaSwitch />
        <ViewSwitch />

        <nav aria-label="Main">
          <ul className="nav">
            {nav.map((n) => {
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
        </nav>

        <div className="sidebar-user">
          <div className="user-name">{me.name}</div>
          <div className="user-meta">
            {me.email}
            <br />
            <span className="badge">{roleLabel(me.role)}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      {/* Re-mount pages on tenant change so they reload their data cleanly. */}
      <main id="main" className="main" key={tenant} tabIndex={-1}>
        {children}
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
