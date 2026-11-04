import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Domain errors carry a stable machine-readable code that the apps map to
 * customer-facing recovery actions. Clients never rely on message text.
 */
export class DomainError extends HttpException {
  constructor(status: HttpStatus, public readonly code: string, message: string, public readonly details?: Record<string, unknown>) {
    super({ error: { code, message, ...(details ? { details } : {}) } }, status);
  }
}

export const Errors = {
  notFound: (what: string) => new DomainError(HttpStatus.NOT_FOUND, 'not_found', `${what} not found`),
  validation: (message: string, details?: Record<string, unknown>) => new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'validation_failed', message, details),
  unauthorised: () => new DomainError(HttpStatus.UNAUTHORIZED, 'unauthorised', 'Authentication required'),
  forbidden: () => new DomainError(HttpStatus.FORBIDDEN, 'forbidden', 'You do not have access to this resource'),
  seatsUnavailable: (seatIds: string[]) =>
    new DomainError(HttpStatus.CONFLICT, 'seats_unavailable', 'Some seats are no longer available', { seatIds }),
  holdExpired: () => new DomainError(HttpStatus.GONE, 'hold_expired', 'Your seat reservation has expired'),
  holdNotActive: () => new DomainError(HttpStatus.CONFLICT, 'hold_not_active', 'This reservation is no longer active'),
  screeningClosed: () => new DomainError(HttpStatus.CONFLICT, 'screening_closed', 'This screening is no longer on sale'),
  seatRules: (violations: { code: string; message: string; seatIds: string[] }[]) =>
    new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'seat_rules', violations[0]?.message ?? 'Seat selection not allowed', { violations }),
  paymentDeclined: (reason: string) => new DomainError(HttpStatus.PAYMENT_REQUIRED, 'payment_declined', 'Your payment was declined', { reason }),
  idempotencyMismatch: () =>
    new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'idempotency_mismatch', 'Idempotency-Key was reused with a different request'),
  idempotencyRequired: () => new DomainError(HttpStatus.BAD_REQUEST, 'idempotency_required', 'Idempotency-Key header is required'),
  publishBlocked: (issues: unknown[]) =>
    new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'publish_blocked', 'Configuration failed validation and cannot be published', { issues }),
};
