/**
 * What a partner API key can do. Keys are read-only unless a write scope is given,
 * and nothing here reaches customer contact details or payment data.
 */
export const SCOPES = {
  'films:read': 'Films, artwork and details',
  'venues:read': 'Cinemas and their screens',
  'screenings:read': 'Showtimes with seats sold and capacity',
  'bookings:read': 'Sales: bookings with amounts, never customer details',
  'shifts:read': 'Shifts at each cinema',
  'shifts:write': 'Add, update and remove shifts (rota systems)',
} as const;
export type Scope = keyof typeof SCOPES;
export const SCOPE_IDS = Object.keys(SCOPES) as Scope[];

/** Events a webhook can subscribe to. */
export const EVENTS = {
  'booking.confirmed': 'A booking is paid and confirmed',
  'booking.refunded': 'A customer cancels and is refunded',
  'shifts.updated': 'Shifts were added, changed or removed',
} as const;
export type EventType = keyof typeof EVENTS;
export const EVENT_IDS = Object.keys(EVENTS) as EventType[];
