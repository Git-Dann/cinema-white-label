'use client';

import type { Report } from '@/lib/api';

export function ContrastReport({ report, pending, appearances }: { report: Report | null; pending: boolean; appearances: string }) {
  if (!report) {
    return <p className="muted">{pending ? 'Checking contrast…' : 'No report yet.'}</p>;
  }
  if (report.ok) {
    return (
      <div className="report report-ok" role="status" aria-live="polite">
        <span className="report-icon" aria-hidden="true">
          ✓
        </span>
        <div>
          <strong>All checks pass</strong>
          <div className="muted small">
            Every text, control and seat colour meets WCAG 2.2 AA in {appearances}.{pending ? ' Rechecking…' : ''}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="report report-fail" role="status" aria-live="polite">
      <div className="report-head">
        <span className="report-icon" aria-hidden="true">
          !
        </span>
        <strong>
          {report.issues.length} {report.issues.length === 1 ? 'issue' : 'issues'} must be fixed before publishing
        </strong>
      </div>
      <ul className="issue-list">
        {report.issues.map((i, idx) => (
          <li key={idx}>
            <span className={`badge ${i.kind === 'contrast' ? 'badge-danger' : 'badge-warning'}`}>
              {i.kind === 'contrast' ? `Contrast · ${i.appearance}` : i.kind === 'palette' ? 'Palette' : 'Schema'}
            </span>
            <span className="issue-msg">{i.kind === 'contrast' ? i.message.replace(/\s*\((light|dark)\)/, '').replace(/ is [\d.]+:1, needs [\d.]+:1$/, '') : i.message}</span>
            {i.ratio !== undefined && i.required !== undefined && (
              <span className="ratio" aria-label={`Ratio ${i.ratio} to 1, needs ${i.required} to 1`}>
                <span className="ratio-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, (i.ratio / i.required) * 100)}%` }} />
                </span>
                <span className="num">
                  {i.ratio.toFixed(2)}:1 <span className="muted">/ {i.required}:1</span>
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
