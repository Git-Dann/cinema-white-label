import { z } from 'zod';

const trimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable();

/**
 * What a customer tells an operator about themselves (`/v1/t/{tenant}/me/profile`).
 * Everything is optional: booking as a guest needs none of it.
 */
export const CustomerProfileInput = z
  .object({
    givenName: trimmed(60),
    familyName: trimmed(60),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .transform((s) => (s === '' ? null : s))
      .nullable()
      .refine((s) => s === null || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s), 'Enter an email address like name@example.com'),
    phone: trimmed(20).refine((s) => s === null || /^\+?[0-9 ()-]{7,20}$/.test(s), 'Enter a phone number'),
    /** Offers and news by email. Off unless the customer turns it on. */
    marketingOptIn: z.boolean(),
  })
  .strict()
  .refine((p) => !p.marketingOptIn || p.email !== null, { message: 'Add an email address to get offers by email', path: ['marketingOptIn'] });
export type CustomerProfileInput = z.infer<typeof CustomerProfileInput>;

export const CustomerProfile = z.object({
  givenName: z.string().nullable(),
  familyName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  marketingOptIn: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type CustomerProfile = z.infer<typeof CustomerProfile>;
