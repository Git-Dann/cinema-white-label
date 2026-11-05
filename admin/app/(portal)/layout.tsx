'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SessionProvider, useSession } from '@/lib/session';
import { roleLabel } from '@/lib/format';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/branding', label: 'Branding & theme' },
  { href: '/releases', label: 'Releases' },
  { href: '/venues', label: 'Cinemas' },
  { href: '/layouts', label: 'Auditorium layouts' },
  { href: '/seating', label: 'Seat categories & pricing' },
  { href: '/food', label: 'Food & drink' },
  { href: '/vouchers', label: 'Vouchers' },
  { href: '/films', label: 'Films' },
];

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me, tenant, setTenant, signOut } = useSession();
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

        <nav aria-label="Main">
          <ul className="nav">
            {NAV.map((n) => {
              const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href);
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

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
