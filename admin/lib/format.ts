export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
}

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Platform admin',
  OPERATOR_ADMIN: 'Operator admin',
  CONTENT_EDITOR: 'Content editor',
  VENUE_MANAGER: 'Venue manager',
};
export const roleLabel = (r: string) => ROLE_LABELS[r] ?? r;

const ACTION_LABELS: Record<string, string> = {
  'draft.update': 'Draft updated',
  'release.publish': 'Release published',
  'release.schedule': 'Release scheduled',
  'release.rollback': 'Rolled back',
  'palette.create': 'Palette created',
  'palette.approve': 'Palette approved',
  'media.upload': 'Image uploaded',
  'venue.create': 'Cinema created',
  'venue.update': 'Cinema updated',
  'venue.delete': 'Cinema deleted',
  'film.create': 'Film created',
  'film.update': 'Film updated',
  'asset.update': 'Image focal point updated',
};
export const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;

/** Short human summary of an audit entry's payload. */
export function auditSummary(action: string, data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  if (action.startsWith('release.')) {
    if ('newVersion' in d) return `v${d.from} → v${d.to} as v${d.newVersion}`;
    return [d.version ? `v${d.version}` : '', d.note ? `“${d.note}”` : ''].filter(Boolean).join(' · ');
  }
  if (action === 'draft.update') return Object.keys(d).join(', ');
  if (typeof d.name === 'string') return d.name;
  if (typeof d.title === 'string') return d.title;
  if (action === 'asset.update' && typeof d.focalX === 'number') return `focal ${(d.focalX as number).toFixed(2)}, ${(d.focalY as number).toFixed(2)}`;
  if (typeof d.kind === 'string') return d.kind.toLowerCase();
  return '';
}

export function permissions(role: string) {
  const operator = role === 'OPERATOR_ADMIN' || role === 'PLATFORM_ADMIN';
  return {
    canPublish: operator,
    canApprovePalette: operator,
    canEditBranding: operator || role === 'CONTENT_EDITOR',
    canEditContent: operator || role === 'CONTENT_EDITOR',
    canEditVenues: operator || role === 'VENUE_MANAGER',
    canDeleteVenues: operator,
  };
}
