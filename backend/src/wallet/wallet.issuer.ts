import { Booking } from '@prisma/client';

/**
 * Apple Wallet pass issuing boundary.
 *
 * A real issuer builds pass.json, signs the manifest with the operator's Pass
 * Type ID certificate and Apple WWDR intermediate (PKCS#7 detached), and
 * returns a .pkpass bundle. It also implements the PassKit web service for
 * updates. That requires Apple Developer certificates we do not have, so the
 * development issuer returns an explicit demo state instead of a fake pass.
 */
export type WalletPassResult =
  | { status: 'issued'; passTypeIdentifier: string; serialNumber: string; pkpassBase64: string }
  | { status: 'demo_unsigned'; passTypeIdentifier: string; serialNumber: string; message: string; passJsonPreview: Record<string, unknown> };

export interface WalletPassIssuer {
  readonly signing: boolean;
  issueEventTicket(input: { booking: Booking; serialNumber: string; authenticationToken: string; passJson: Record<string, unknown> }): Promise<WalletPassResult>;
}

export const WALLET_ISSUER = Symbol('WALLET_ISSUER');

export class DemoWalletPassIssuer implements WalletPassIssuer {
  readonly signing = false;
  async issueEventTicket(input: { serialNumber: string; passJson: Record<string, unknown> }): Promise<WalletPassResult> {
    return {
      status: 'demo_unsigned',
      passTypeIdentifier: String(input.passJson.passTypeIdentifier),
      serialNumber: input.serialNumber,
      message: 'Apple Wallet passes need a signed Pass Type ID certificate. This development build shows your ticket in the app instead.',
      passJsonPreview: input.passJson,
    };
  }
}
