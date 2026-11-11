'use client';

import Link from 'next/link';
import { AuditEntry, Release, Stats, tenantPath } from '@/lib/api';
import { actionLabel, auditSummary, formatDateTime, formatMoney } from '@/lib/format';
import { useSession, useTenantData } from '@/lib/session';
import { ErrorNote, Loading, PageHeader, StatusBadge } from '@/components/ui';
import { useCinemaScope } from '@/lib/cinema-scope';
import { PerformancePreview } from './performance-preview';

export default function OverviewPage() {
  const { tenant, tenantName } = useSession();
  const scope = useCinemaScope();
  const stats = useTenantData<Stats>(tenantPath(tenant, scope.venueId ? `/stats?venueId=${scope.venueId}` : '/stats'));
  const audit = useTenantData<AuditEntry[]>(tenantPath(tenant, '/audit'));
  const releases = useTenantData<Release[]>(tenantPath(tenant, '/releases'));
  const live = releases.data?.find((r) => r.status === 'PUBLISHED');
  const scheduled = releases.data?.filter((r) => r.status === 'SCHEDULED') ?? [];

  return (
    <>
      <PageHeader title="Overview" description={`${scope.venue?.name ?? tenantName} · last 30 days`} />
      <ErrorNote message={stats.error} />
      <section aria-label="Key figures" className="stat-grid">
        <StatCard label="Confirmed bookings" value={stats.data ? stats.data.bookings.toLocaleString('en-GB') : '—'} />
        <StatCard label="Revenue" value={stats.data ? formatMoney(stats.data.revenueMinor, stats.data.currency) : '—'} />
        <StatCard label="Cinemas" value={stats.data ? String(stats.data.venues) : '—'} href="/venues" />
        <StatCard label="Films" value={stats.data ? String(stats.data.films) : '—'} href="/films" />
      </section>

      <PerformancePreview />

      <div className="grid-2">
        <section className="card" aria-labelledby="audit-title">
          <h2 id="audit-title" className="h3">
            Recent activity
          </h2>
          <ErrorNote message={audit.error} />
          {audit.loading && !audit.data && <Loading />}
          {audit.data && audit.data.length === 0 && <p className="muted">No activity yet.</p>}
          {audit.data && audit.data.length > 0 && (
            <ol className="audit-list">
              {audit.data.slice(0, 12).map((a) => (
                <li key={a.id}>
                  <div>
                    <div className="audit-action">{actionLabel(a.action)}</div>
                    <div className="audit-detail">{auditSummary(a.action, a.data)}</div>
                  </div>
                  <time className="audit-time" dateTime={a.createdAt}>
                    {formatDateTime(a.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card" aria-labelledby="release-title">
          <h2 id="release-title" className="h3">
            App configuration
          </h2>
          <ErrorNote message={releases.error} />
          {live ? (
            <dl className="kv">
              <dt>Live version</dt>
              <dd>
                v{live.version} <StatusBadge status={live.status} />
              </dd>
              <dt>Published</dt>
              <dd>{formatDateTime(live.publishedAt)}</dd>
              <dt>Note</dt>
              <dd>{live.note ?? '—'}</dd>
              <dt>Scheduled</dt>
              <dd>{scheduled.length ? scheduled.map((s) => `v${s.version} at ${formatDateTime(s.scheduledFor)}`).join(', ') : 'None'}</dd>
            </dl>
          ) : (
            releases.loading ? <Loading /> : <p className="muted">Nothing published yet.</p>
          )}
          <div className="row gap-1 mt-2">
            <Link className="btn btn-sm" href="/branding">
              Edit branding
            </Link>
            <Link className="btn btn-sm btn-ghost" href="/releases">
              View releases
            </Link>
          </div>
          {stats.data && Object.keys(stats.data.events).length > 0 && (
            <>
              <h3 className="h4 mt-3">App events</h3>
              <ul className="event-list">
                {Object.entries(stats.data.events).map(([k, v]) => (
                  <li key={k}>
                    <span>{k.replace(/_/g, ' ')}</span>
                    <span className="num">{v.toLocaleString('en-GB')}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function StatCard({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </>
  );
  return href ? (
    <Link href={href} className="card stat-card link-card">
      {body}
    </Link>
  ) : (
    <div className="card stat-card">{body}</div>
  );
}
