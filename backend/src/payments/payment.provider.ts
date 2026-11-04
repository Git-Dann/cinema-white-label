/**
 * Payment service provider boundary. Real providers (Stripe, Adyen, Worldpay…)
 * implement this with Apple Pay token support; see docs/apple-integrations.md.
 * The backend never sees raw card data.
 */
export interface PaymentRequest {
  amountMinor: number;
  currency: string;
  /** Stable per booking attempt so provider-side retries are deduplicated. */
  idempotencyKey: string;
  description: string;
  method: { type: 'simulated'; outcome?: 'approve' | 'decline' } | { type: 'applePay'; token: string };
}

export type PaymentResult =
  | { status: 'approved'; provider: string; providerRef: string }
  | { status: 'declined'; provider: string; providerRef: string; reason: string };

export interface PaymentProvider {
  readonly id: string;
  authoriseAndCapture(req: PaymentRequest): Promise<PaymentResult>;
  /** Used when a payment succeeded but seats could not be confirmed. */
  voidOrRefund(providerRef: string, amountMinor: number): Promise<void>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/**
 * Development-only provider. It is clearly labelled in API responses and the
 * app shows "Simulated payment – no money taken". It must never be enabled
 * for a production tenant (enforced in BookingsService).
 */
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly id = 'simulated';
  private readonly seen = new Map<string, PaymentResult>();
  readonly voided: string[] = [];

  async authoriseAndCapture(req: PaymentRequest): Promise<PaymentResult> {
    const prior = this.seen.get(req.idempotencyKey);
    if (prior) return prior;
    if (req.method.type !== 'simulated') {
      return { status: 'declined', provider: this.id, providerRef: `sim_${req.idempotencyKey}`, reason: 'Apple Pay requires a configured payment provider' };
    }
    const result: PaymentResult =
      req.method.outcome === 'decline'
        ? { status: 'declined', provider: this.id, providerRef: `sim_${req.idempotencyKey}`, reason: 'Simulated decline' }
        : { status: 'approved', provider: this.id, providerRef: `sim_${req.idempotencyKey}` };
    this.seen.set(req.idempotencyKey, result);
    return result;
  }

  async voidOrRefund(providerRef: string): Promise<void> {
    this.voided.push(providerRef);
  }
}
