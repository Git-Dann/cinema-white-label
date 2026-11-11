'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SessionProvider, useSession } from '@/lib/session';
import { roleLabel } from '@/lib/format';
import { CinemaScopeProvider, useCinemaScope } from '@/lib/cinema-scope';
import { HOME, useViewAs, VIEW_LABELS, ViewAsProvider, type ViewAs } from '@/lib/view-as';
import { Icon, type IconName } from '@/components/Icon';

const H: ViewAs[] = ['head-office'];
const HV: ViewAs[] = ['head-office', 'venue'];

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  views: ViewAs[];
  /** Reporting reads the numbers: pages that only set things up are left out of its menu. */
  setupOnly?: boolean;
}

/**
 * The menu, grouped by the job people come to do. Each role sees only its items;
 * labels say what's on the page in plain words (URLs stay as they were).
 */
const NAV: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [
    { href: '/', label: 'Overview', icon: 'home', views: H },
    { href: '/today', label: 'Today', icon: 'today', views: ['venue'] },
    { href: '/my-week', label: 'My week', icon: 'calendar', views: ['floor'] },
  ] },
  { group: 'Plan', items: [
    { href: '/insights', label: 'Insights', icon: 'chart', views: H },
    { href: '/pulse', label: 'Pulse', icon: 'pulse', views: HV },
    { href: '/year-ahead', label: 'Year ahead', icon: 'spark', views: H },
    { href: '/next-weeks', label: 'Next 6 weeks', icon: 'spark', views: HV },
  ] },
  { group: 'What’s on', items: [
    { href: '/films', label: 'Films', icon: 'film', views: HV },
    { href: '/venues', label: 'Cinemas', icon: 'building', views: HV },
    { href: '/layouts', label: 'Screens & seat maps', icon: 'screen', views: HV, setupOnly: true },
    { href: '/seating', label: 'Seats & ticket prices', icon: 'seat', views: HV, setupOnly: true },
  ] },
  { group: 'Sell', items: [
    { href: '/food', label: 'Food & drink', icon: 'food', views: HV },
    { href: '/promotions', label: 'Offers', icon: 'megaphone', views: H },
    { href: '/vouchers', label: 'Vouchers', icon: 'ticket', views: H },
    { href: '/loyalty', label: 'Loyalty & memberships', icon: 'star', views: H },
  ] },
  { group: 'Setup', items: [
    { href: '/branding', label: 'Branding & theme', icon: 'palette', views: H, setupOnly: true },
    { href: '/releases', label: 'Releases', icon: 'layers', views: H, setupOnly: true },
    { href: '/connections', label: 'Connections', icon: 'plug', views: H },
    { href: '/team', label: 'Team & roles', icon: 'people', views: H },
  ] },
];

const isActive = (href: string, pathname: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
const COLLAPSED_KEY = 'cinema.admin.navCollapsed';
const BUILD = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local';

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, tenant, setTenant } = useSession();
  const { view } = useViewAs();
  const reporting = me.role === 'REPORTING';
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((n) => n.views.includes(view) && !(reporting && n.setupOnly)) })).filter((g) => g.items.length);
  const allowed = groups.flatMap((g) => g.items);
  // A page this view doesn't have (a typed URL, a bookmark, a view switch) goes to the view's home.
  const blocked = !allowed.some((n) => isActive(n.href, pathname));
  useEffect(() => {
    if (blocked) router.replace(HOME[view]);
  }, [blocked, view, router]);

  // Groups fold away; the one holding the current page always stays open.
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    try {
      setCollapsed(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'));
    } catch {
      setCollapsed([]);
    }
  }, []);
  const toggle = (g: string) => {
    const next = collapsed.includes(g) ? collapsed.filter((x) => x !== g) : [...collapsed, g];
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked: keep it for this visit */
    }
  };

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
          <div className="context-row">
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

        <nav aria-label="Main" className="side-nav">
          {groups.map((g) => {
            const holdsCurrent = g.items.some((n) => isActive(n.href, pathname));
            const open = !g.group || holdsCurrent || !collapsed.includes(g.group);
            const id = `nav-${(g.group ?? 'home').replace(/\W+/g, '-').toLowerCase()}`;
            return (
              <div key={g.group ?? 'home'} className="nav-group">
                {g.group && (
                  <button type="button" className="nav-group-label" aria-expanded={open} aria-controls={id} onClick={() => toggle(g.group!)} disabled={holdsCurrent}>
                    <span>{g.group}</span>
                    {!holdsCurrent && <Icon name="chevron" className={`nav-chevron${open ? ' open' : ''}`} />}
                  </button>
                )}
                {open && (
                  <ul className="nav" id={id}>
                    {g.items.map((n) => {
                      const active = isActive(n.href, pathname);
                      return (
                        <li key={n.href}>
                          <Link href={n.href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
                            <Icon name={n.icon} className="nav-icon" />
                            <span>{n.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <AccountCard />
        <div className="sidebar-build">Seatfold · build {BUILD}</div>
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
    <div className="context-row">
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

/**
 * Who's signed in, as a card at the foot of the menu. It opens upwards with the demo's
 * "Preview as" switch and Sign out.
 */
function AccountCard() {
  const { me, signOut } = useSession();
  const { view, views, setView } = useViewAs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const initials = me.name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="account" ref={ref}>
      {open && (
        <div className="account-menu" role="menu" aria-label="Account">
          {views.length > 1 && (
            <div className="account-section">
              <div className="account-label">
                Preview as <span className="badge badge-sample">Demo</span>
              </div>
              <div className="account-views" role="radiogroup" aria-label="Preview as">
                {views.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={v === view}
                    className={`account-view${v === view ? ' on' : ''}`}
                    onClick={() => {
                      setView(v);
                      setOpen(false);
                    }}
                  >
                    <Icon name={v === 'head-office' ? 'building' : v === 'venue' ? 'today' : 'people'} />
                    <span>{VIEW_LABELS[v]}</span>
                    {v === view && <span className="account-tick" aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button type="button" role="menuitem" className="account-item" onClick={signOut}>
            <Icon name="signout" />
            <span>Sign out</span>
          </button>
        </div>
      )}
      <button type="button" className="account-card" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="sidebar-avatar" aria-hidden="true">{initials}</span>
        <span className="account-who">
          <span className="user-name">{me.name}</span>
          <span className="user-meta">{views.length > 1 ? `${roleLabel(me.role)} · viewing as ${VIEW_LABELS[view].toLowerCase()}` : me.email}</span>
        </span>
        <Icon name="updown" className="account-chevron" />
      </button>
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
