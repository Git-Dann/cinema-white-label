import { mkdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { Errors } from '../common/errors';

/**
 * Where original media bytes live. Local disk in development; object storage
 * (S3/GCS/R2) in production. Providers (operator uploads, distributor feeds,
 * Vista or another licensed CDN) only ever write through this interface after
 * rights metadata is recorded, so apps never depend on a third-party CDN.
 */
export interface MediaStorage {
  read(storageKey: string): Promise<Buffer>;
  write(storageKey: string, data: Buffer): Promise<void>;
}

export class LocalMediaStorage implements MediaStorage {
  constructor(private readonly roots: Record<string, string>) {}

  private path(storageKey: string): string {
    const [root, ...rest] = storageKey.split('/');
    const base = this.roots[root];
    if (!base) throw Errors.notFound('Image');
    const p = resolve(base, rest.join('/'));
    if (!p.startsWith(base)) throw Errors.forbidden();
    return p;
  }

  read(storageKey: string) {
    return readFile(this.path(storageKey));
  }

  async write(storageKey: string, data: Buffer) {
    const p = this.path(storageKey);
    mkdirSync(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
}

/**
 * Public URL for an asset. With MEDIA_CDN_BASE set (e.g. https://media.example.com),
 * URLs are absolute CDN URLs that front /v1/media; otherwise they are relative
 * to the API. Apps accept both.
 */
export function publicMediaUrl(assetId: string, version: number): string {
  const cdn = process.env.MEDIA_CDN_BASE?.replace(/\/$/, '');
  return `${cdn ?? ''}/v1/media/${assetId}?v=${version}`;
}
