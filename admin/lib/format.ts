export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100);
}

/** Minor units to a plain decimal string for inputs, e.g. 1250 -> "12.50". */
export function minorToInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  return (minor / 100).toFixed(2);
}

/** Parses a pounds-and-pence input to minor units. '' -> null; invalid -> NaN. */
export function inputToMinor(value: string): number | null {
  const v = value.trim().replace(/^£/, '');
  if (v === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return NaN;
  return Math.round(Number(v) * 100);
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
  REPORTING: 'Reporting',
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
  'seatCategory.create': 'Seat category created',
  'seatCategory.update': 'Seat category updated',
  'seatCategory.delete': 'Seat category deleted',
  'pricing.update': 'Ticket prices updated',
  'concession.create': 'Product created',
  'concession.update': 'Product updated',
  'concession.delete': 'Product deleted',
  'voucher.create': 'Voucher created',
  'voucher.update': 'Voucher updated',
  'auditorium.create': 'Screen created',
  'layout.draft.create': 'Layout draft created',
  'layout.draft.update': 'Layout draft saved',
  'layout.draft.delete': 'Layout draft deleted',
  'layout.publish': 'Layout published',
  'auditorium.update': 'Screen updated',
  'auditorium.delete': 'Screen deleted',
  'film.content_advice': 'Parents guide updated',
  'film.import_tmdb': 'Films imported from TMDB',
  'loyalty.update': 'Loyalty updated',
  'membershipPlan.create': 'Membership created',
  'membershipPlan.update': 'Membership updated',
  'membershipPlan.delete': 'Membership deleted',
  'pricing.fees.update': 'Booking fees updated',
  'promotion.create': 'Offer created',
  'promotion.update': 'Offer updated',
  'promotion.delete': 'Offer deleted',
  'team.add': 'Person added',
  'team.remove': 'Person removed',
  'team.role': 'Role changed',
  'api_key.create': 'API key created',
  'api_key.revoke': 'API key revoked',
  'webhook.create': 'Webhook added',
  'webhook.update': 'Webhook updated',
  'webhook.delete': 'Webhook removed',
};
/** Known actions read as plain words; anything new still reads as a sentence, never a raw code. */
export const actionLabel = (a: string) => {
  if (ACTION_LABELS[a]) return ACTION_LABELS[a];
  const words = a.replace(/[._]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

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
    /** Ticket prices and vouchers: operator admins only (server enforces the same). */
    canEditPricing: operator,
    canEditVouchers: operator,
    canEditSeatCategories: operator || role === 'VENUE_MANAGER',
    canDeleteSeatCategories: operator,
    canEditConcessions: operator || role === 'VENUE_MANAGER',
    canEditLayouts: operator || role === 'VENUE_MANAGER',
    canPublishLayouts: operator,
    /** Adding people and changing roles: operator admins only (server enforces the same). */
    canManageTeam: operator,
  };
}

/** A rota source as people know it: sources arrive lower-case ("planday"), so known ones get their real names. */
const ROTA_NAMES: Record<string, string> = { planday: 'Planday', deputy: 'Deputy', rotacloud: 'RotaCloud' };
export const rotaName = (source: string) => ROTA_NAMES[source] ?? (source ? source[0].toUpperCase() + source.slice(1) : source);
