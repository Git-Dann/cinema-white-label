import { describe, expect, it } from 'vitest';
import { CustomerProfileInput } from './index';

const base = { givenName: 'Dan', familyName: 'Lindsay', email: 'Dan@Example.com ', phone: '07700 900123', marketingOptIn: false };

describe('customer profile', () => {
  it('tidies what the customer typed', () => {
    const p = CustomerProfileInput.parse({ ...base, givenName: '  Dan ', familyName: '' });
    expect(p).toMatchObject({ givenName: 'Dan', familyName: null, email: 'dan@example.com' });
  });

  it('rejects an email or phone number that cannot be right', () => {
    expect(CustomerProfileInput.safeParse({ ...base, email: 'dan@' }).success).toBe(false);
    expect(CustomerProfileInput.safeParse({ ...base, phone: 'call me' }).success).toBe(false);
    expect(CustomerProfileInput.safeParse({ ...base, email: '', phone: '' }).success).toBe(true);
  });

  it('only allows marketing emails when there is an email address', () => {
    expect(CustomerProfileInput.safeParse({ ...base, email: null, marketingOptIn: true }).success).toBe(false);
    expect(CustomerProfileInput.safeParse({ ...base, marketingOptIn: true }).success).toBe(true);
  });

  it('refuses fields it does not know', () => {
    expect(CustomerProfileInput.safeParse({ ...base, tenantId: 'x' }).success).toBe(false);
  });
});
