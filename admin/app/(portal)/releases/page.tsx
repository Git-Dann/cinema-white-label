'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TenantConfig } from '@cinema/contracts';
import { api, errorMessage, mediaUrl, Release, tenantPath } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useSession, useTenantData } from '@/lib/session';
import { ErrorNote, Loading, PageHeader, StatusBadge, SuccessNote } from '@/components/ui';
import { SafeImage } from '@/components/SafeImage';

export default function ReleasesPage() {
  const { tenant, can } = useSession();
  const releases = useTenantData<Release[]>(tenantPath(tenant, '/releases'));
  const [live, setLive] = useState<TenantConfig | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  const loadLive = useCallback(() => {
    setLiveError(null);
    api<TenantConfig>(`/v1/t/${encodeURIComponent(tenant)}/config`, { auth: false })
      .then(setLive)
      .catch((e) => setLiveError(errorMessage(e)));
  }, [tenant]);
  useEffect(loadLive, [loadLive]);

  const latestPublished = releases.data?.find((r) => r.status === 'PUBLISHED')?.version;

  async function rollback(version: number) {
    if (!window.confirm(`Republish the configuration from version ${version}? This creates a new version; history is kept.`)) return;
    setBusy(version);
    setMsg({});
    try {
      const r = await api<Release>(tenantPath(tenant, `/releases/${version}/rollback`), { method: 'POST' });
      setMsg({ ok: `Rolled back: version ${r.version} now serves the configuration from version ${version}.` });
      releases.reload();
      loadLive();
    } catch (e) {
      setMsg({ error: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Releases" description="Every publish creates an immutable, numbered configuration. Rolling back republishes an earlier version as a new one." />
      <ErrorNote message={msg.error} />
      <SuccessNote message={msg.ok} />
      <div className="releases-layout">
        <section className="card" aria-labelledby="history-title">
          <h2 id="history-title" className="h3">
            History
          </h2>
          <ErrorNote message={releases.error} />
          {releases.loading && !releases.data && <Loading />}
          {releases.data && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col">Status</th>
                    <th scope="col">Note</th>
                    <th scope="col">Published / scheduled</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {releases.data.map((r) => (
                    <tr key={r.id}>
                      <td className="num">v{r.version}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td>{r.note ?? <span className="muted">—</span>}</td>
                      <td className="nowrap">{r.status === 'SCHEDULED' ? `Scheduled ${formatDateTime(r.scheduledFor)}` : formatDateTime(r.publishedAt)}</td>
                      <td className="actions">
                        {can.canPublish && r.status !== 'SCHEDULED' && r.version !== latestPublished && (
                          <button className="btn btn-sm" onClick={() => rollback(r.version)} disabled={busy !== null} aria-label={`Roll back to version ${r.version}`}>
                            {busy === r.version ? 'Rolling back…' : 'Roll back to this'}
                          </button>
                        )}
                        {r.version === latestPublished && <span className="muted small">Live</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="live-title">
          <div className="row between">
            <h2 id="live-title" className="h3">
              Live config
            </h2>
            <button className="btn btn-sm btn-ghost" onClick={loadLive}>
              Refresh
            </button>
          </div>
          <p className="muted small">
            What the iOS app receives from <code>GET /v1/t/{tenant}/config</code>.
          </p>
          <ErrorNote message={liveError} />
          {live ? (
            <>
              <div className="live-version" data-testid="live-version">
                v{live.version}
              </div>
              <dl className="kv">
                <dt>Published</dt>
                <dd>{formatDateTime(live.publishedAt)}</dd>
                <dt>Theme</dt>
                <dd>{live.theme.name}</dd>
                <dt>Palette</dt>
                <dd>
                  <span className="swatches inline" aria-hidden="true">
                    <span style={{ background: live.branding.palette.accent.light }} />
                    <span style={{ background: live.branding.palette.accent.dark }} />
                  </span>
                  {live.branding.palette.name}
                </dd>
                <dt>Appearance</dt>
                <dd>{live.theme.appearancePolicy}</dd>
                <dt>Wordmark</dt>
                <dd>{live.branding.wordmark}</dd>
                <dt>Logo</dt>
                <dd>
                  {live.branding.logoDarkUrl ? (
                    <SafeImage className="live-logo" src={mediaUrl(live.branding.logoDarkUrl)} alt={`${live.branding.wordmark} logo`} style={{ background: live.theme.dark.background }} fallback={live.branding.wordmark} />
                  ) : (
                    '—'
                  )}
                </dd>
              </dl>
              <details className="disclosure">
                <summary>Raw JSON</summary>
                <pre className="code">{JSON.stringify(live, null, 2)}</pre>
              </details>
            </>
          ) : (
            !liveError && <Loading />
          )}
        </section>
      </div>
    </>
  );
}
