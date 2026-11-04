'use client';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1 className="h1">{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function ErrorNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p className="alert alert-error" role="alert">
      {message}
    </p>
  );
}

export function SuccessNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p className="alert alert-success" role="status">
      {message}
    </p>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cls = status === 'PUBLISHED' ? 'badge-success' : status === 'SCHEDULED' ? 'badge-warning' : 'badge-neutral';
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="muted" aria-busy="true">
      {label}
    </p>
  );
}
