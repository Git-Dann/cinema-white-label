import type { BrandPalette, ResolvedTheme, ThemeId, AppearancePolicy, TenantConfig } from '@cinema/contracts';

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000').replace(/\/$/, '');

/** Media URLs in API responses are relative (/v1/media/...); prefix with the API base. */
export function mediaUrl(path: string | null | undefined, width?: number): string | null {
  if (!path) return null;
  const abs = path.startsWith('http') ? path : `${API_BASE}${path}`;
  if (!width) return abs;
  return abs + (abs.includes('?') ? '&' : '?') + `w=${width}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/*
 * KNOWN GAP (dev milestone): the admin bearer token is kept in localStorage so the
 * browser can call the API directly. Anything running on this origin can read it
 * (XSS exposure). Production should move to an httpOnly, Secure, SameSite cookie
 * issued by the API (or a backend-for-frontend route) and drop client-side storage.
 */
const TOKEN_KEY = 'cinema.admin.token';
const USER_KEY = 'cinema.admin.user';

export type Role = 'PLATFORM_ADMIN' | 'OPERATOR_ADMIN' | 'CONTENT_EDITOR' | 'VENUE_MANAGER' | (string & {});

export interface LoginUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantSlug: string | null;
}

/*
 * "Remember me" keeps the session in localStorage (it survives closing the browser, and the API
 * issues a 30-day token). Without it the session lives in sessionStorage and ends with the tab
 * or window, on top of the API's 8-hour token.
 */
const REMEMBER_EMAIL_KEY = 'cinema.admin.rememberedEmail';

function stores(): Storage[] {
  const out: Storage[] = [];
  try {
    out.push(sessionStorage);
  } catch {
    /* unavailable */
  }
  try {
    out.push(localStorage);
  } catch {
    /* unavailable */
  }
  return out;
}

export function getToken(): string | null {
  for (const s of stores()) {
    const t = s.getItem(TOKEN_KEY);
    if (t) return t;
  }
  return null;
}

export function setSession(token: string, user: LoginUser, remember = false) {
  clearSession();
  const store = remember ? localStorage : sessionStorage;
  store.setItem(TOKEN_KEY, token);
  store.setItem(USER_KEY, JSON.stringify(user));
  try {
    if (remember) localStorage.setItem(REMEMBER_EMAIL_KEY, user.email);
    else localStorage.removeItem(REMEMBER_EMAIL_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** The email of the last person who chose "Remember me" on this device, to prefill the sign-in form. */
export function rememberedEmail(): string | null {
  try {
    return localStorage.getItem(REMEMBER_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function clearSession() {
  for (const s of stores()) {
    s.removeItem(TOKEN_KEY);
    s.removeItem(USER_KEY);
  }
}

let unauthorisedHandler: (() => void) | null = null;
export function onUnauthorised(fn: (() => void) | null) {
  unauthorisedHandler = fn;
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const token = init.auth === false ? null : getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      cache: 'no-store',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', `Could not reach the API at ${API_BASE}. Check that it is running.`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    const fallback = (json as { message?: string | string[] } | null)?.message;
    const message = err?.message ?? (Array.isArray(fallback) ? fallback.join(', ') : fallback) ?? `Request failed (${res.status})`;
    if (res.status === 401 && init.auth !== false && unauthorisedHandler) unauthorisedHandler();
    throw new ApiError(res.status, err?.code ?? 'http_error', message, err?.details);
  }
  return json as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

export const tenantPath = (tenant: string, rest: string) => `/v1/admin/t/${encodeURIComponent(tenant)}${rest}`;

// ---- Response shapes ----

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenants: { slug: string; name: string }[];
}

export interface FeatureFlags {
  memberships: boolean;
  concessions: boolean;
  wallet: boolean;
  applePay: boolean;
  liveActivities: boolean;
  guestCheckout: boolean;
}

export interface Draft {
  themeId: ThemeId;
  paletteId: string;
  appearancePolicy: AppearancePolicy | null;
  availableThemes: ThemeId[];
  wordmark: string;
  logoLightAssetId: string | null;
  logoDarkAssetId: string | null;
  markAssetId: string | null;
  features: FeatureFlags;
  home: { id: string; kind: string; title: string; subtitle?: string }[];
  support: { email: string; phone: string | null; url: string | null };
  legal: { termsUrl: string; privacyUrl: string; companyName: string };
}

export interface ReportIssue {
  kind: 'contrast' | 'schema' | 'palette';
  message: string;
  appearance?: string;
  ratio?: number;
  required?: number;
}

export interface Report {
  ok: boolean;
  issues: ReportIssue[];
}

export type Palette = BrandPalette & { approved: boolean };

export interface Settings {
  tenant: { slug: string; name: string; currency: string; timeZone: string };
  draft: Draft;
  themes: { id: ThemeId; name: string; appearancePolicy: AppearancePolicy }[];
  palettes: Palette[];
  preview: { theme: ResolvedTheme; report: Report } | null;
}

export interface PreviewResult {
  theme: ResolvedTheme;
  branding: TenantConfig['branding'];
  report: Report;
}

export interface Release {
  id: string;
  version: number;
  status: 'PUBLISHED' | 'SCHEDULED' | 'SUPERSEDED' | (string & {});
  note: string | null;
  scheduledFor: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  data: unknown;
  createdAt: string;
}

export interface Stats {
  currency: string;
  bookings: number;
  revenueMinor: number;
  venues: number;
  films: number;
  events: Record<string, number>;
}

export interface Venue {
  id: string;
  slug: string;
  name: string;
  address: { line1: string; city: string; postcode: string };
  coordinate: { latitude: number; longitude: number };
  timeZone: string;
  phone: string | null;
  facilities: string[];
  screenCount: number | null;
  /** The cinema's photo, if it has one. */
  image?: ImageRef | null;
}

export interface ImageRef {
  id: string;
  url: string;
  width: number;
  height: number;
  focalPoint: { x: number; y: number };
  dominantColor: string | null;
  attribution?: string | null;
}

export interface FilmAsset {
  id: string;
  kind: 'POSTER' | 'BACKDROP' | 'BANNER' | 'LOGO' | (string & {});
  provider: string;
  width: number;
  height: number;
  focalX: number;
  focalY: number;
  isPreferred: boolean;
  licenceRef: string | null;
  attribution: string | null;
  expiresAt: string | null;
  url: string;
}

export interface Film {
  id: string;
  /** Left out of the app's listings (e.g. fictional films while the TMDB demo catalogue is on). */
  hidden?: boolean;
  slug: string;
  title: string;
  tagline: string | null;
  synopsis: string;
  releaseDate: string;
  runtimeMinutes: number;
  certificate: string;
  genres: string[];
  director: string | null;
  cast: string[];
  status: 'nowShowing' | 'comingSoon';
  poster: ImageRef | null;
  backdrop: ImageRef | null;
  assets: FilmAsset[];
  /** Parents Guide: certificate meaning and content advice (from the provider, or typed in here). */
  contentAdvice?: {
    certificate: string;
    meaning: string | null;
    items: ContentAdviceItem[];
    source: 'provider' | 'operator';
    moreInfoUrl: string;
  };
  people?: { id: string; name: string; character: string | null }[];
}

export type AdviceLevel = 'Strong' | 'Moderate' | 'Mild' | 'Contains';
export interface ContentAdviceItem {
  category: string;
  level: AdviceLevel;
  text: string;
}

// ---- Seating, pricing, food and drink, vouchers, layouts ----

export interface SeatCategoryColours {
  light: { fill: string; accent: string };
  dark: { fill: string; accent: string };
}

export interface SeatCategoryDto {
  id: string;
  label: string;
  description: string | null;
  shape: string;
  icon: string | null;
  colours: SeatCategoryColours | null;
  sortOrder: number;
}

export interface SeatCategoriesResponse {
  categories: SeatCategoryDto[];
  shapes: string[];
  icons: string[];
}

export interface PricingResponse {
  currency: string;
  bookingFeeMinor: number;
  categories: SeatCategoryDto[];
  ticketTypes: { id: string; code: string; name: string; prices: Record<string, number | null> }[];
  supplements: { format: string; amountMinor: number }[];
  /** Formats used by this operator's screenings; supplements must match one exactly to apply. */
  knownFormats: string[];
}

export interface ModifierOption {
  id: string;
  name: string;
  priceMinor: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: ModifierOption[];
}

export type StockStatus = 'inStock' | 'low' | 'out';

export interface Concession {
  id: string;
  venueId: string | null;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  priceMinor: number;
  allergens: string[];
  dietary: string[];
  calories: number | null;
  stockStatus: StockStatus;
  available: boolean;
  modifierGroups: ModifierGroup[];
  bundleItems: string[];
  sortOrder: number;
  imageAssetId: string | null;
  image: ImageRef | null;
  featured: boolean;
  badge: string | null;
  compareAtMinor: number | null;
  filmId: string | null;
  limitedEdition: boolean;
  availableFrom: string | null;
  availableUntil: string | null;
}

export interface Voucher {
  id: string;
  code: string;
  description: string;
  kind: 'percentOff' | 'amountOff';
  value: number;
  appliesTo: 'tickets' | 'concessions' | 'all';
  minSpendMinor: number;
  validFrom: string | null;
  validTo: string | null;
  maxRedemptions: number | null;
  redemptions: number;
  active: boolean;
  venueId: string | null;
}

export type LayoutStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';

export interface LayoutVersionSummary {
  id: string;
  version: number;
  status: LayoutStatus;
  seatCount: number;
  publishedAt: string | null;
  createdAt: string;
}

export interface AuditoriumSummary {
  id: string;
  name: string;
  screenNumber: number;
  versions: LayoutVersionSummary[];
}

export interface VenueAuditoriums {
  venue: { id: string; name: string };
  auditoriums: AuditoriumSummary[];
}

export interface LayoutIssueDto {
  code: string;
  message: string;
  seatId?: string;
}

export interface LayoutVersionDetail extends LayoutVersionSummary {
  auditorium: { id: string; name: string };
  geometry: import('@cinema/contracts').AuditoriumLayout;
  screenings: number;
  issues: LayoutIssueDto[];
}

export interface LayoutValidation {
  ok: boolean;
  issues: LayoutIssueDto[];
  seatCount: number;
}

/** Human-readable lines from an ApiError's details.issues (zod issues, contrast issues or layout issues). */
export function errorDetails(e: unknown): string[] {
  if (!(e instanceof ApiError) || !e.details || typeof e.details !== 'object') return [];
  const issues = (e.details as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.map((raw) => {
    const i = raw as { message?: string; path?: (string | number)[]; themeId?: string; appearance?: string; code?: string };
    const where = i.path?.length ? `${i.path.join('.')}: ` : i.themeId ? `${i.themeId} theme, ${i.appearance ?? ''} appearance: ` : '';
    return `${where}${i.message ?? i.code ?? 'Invalid value'}`;
  });
}

export type PromotionActionKind = 'film' | 'voucher' | 'link' | 'none';

export interface Promotion {
  id: string;
  title: string;
  body: string;
  ctaLabel: string;
  action: PromotionActionKind;
  filmId: string | null;
  voucherCode: string | null;
  linkUrl: string | null;
  venueId: string | null;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  sortOrder: number;
  /** Whether customers can see it right now (operator-wide promotions only; null when cinema-specific). */
  showing: boolean | null;
  imageAssetId: string | null;
  /** The banner photo; for a film offer without one, the film's backdrop. */
  image: ImageRef | null;
}

export interface LoyaltyProgram {
  name: string;
  enabled: boolean;
  earnPointsPerPound: number;
  redeemPointsPerPound: number;
  minRedeemPoints: number;
}

export interface LoyaltyResponse {
  /** null when the operator has not set up a points scheme. */
  program: LoyaltyProgram | null;
  stats: { accounts: number; pointsOutstanding: number };
}

export interface MembershipEntitlements {
  ticketDiscountPercent: number;
  foodDiscountPercent: number;
  bookingFeeWaived: boolean;
  /** 1 to 5, in steps of 0.5. */
  pointsMultiplier: number;
}

export interface MembershipPlan {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  interval: 'month' | 'year';
  entitlements: MembershipEntitlements;
  active: boolean;
  sortOrder: number;
  /** Customers whose paid period has not ended. */
  activeMembers: number;
}

/** One cinema's shows on a day (GET /venues/:id/today). */
export interface VenueToday {
  venue: { id: string; name: string; timeZone: string };
  date: string;
  totals: { shows: number; capacity: number; sold: number; foodOrders: number };
  shows: {
    id: string;
    startsAt: string;
    endsAt: string;
    screen: string;
    formats: string[];
    film: { id: string; title: string; certificate: string; poster: ImageRef | null };
    capacity: number;
    sold: number;
    held: number;
    occupancy: number;
    foodOrders: number;
    started: boolean;
  }[];
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

// ---- Connections (API keys, webhooks, shifts) ----

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface WebhookRow {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  createdAt: string;
  deliveries: { id: string; event: string; eventId: string; status: 'delivered' | 'failed'; responseCode: number | null; error: string | null; attempts: number; durationMs: number | null; createdAt: string }[];
}

export interface IntegrationCatalogue {
  scopes: { id: string; label: string }[];
  events: { id: string; label: string }[];
}

export interface ShiftRow {
  id: string;
  venueId: string;
  source: string;
  externalId: string;
  staffName: string;
  staffEmail: string | null;
  role: string;
  startsAt: string;
  endsAt: string;
  note: string | null;
}
