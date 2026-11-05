import type { PrismaClient } from '@prisma/client';
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

/** The slice of Prisma used for upload bytes. */
export type BlobStore = Pick<PrismaClient, 'mediaBlob'>;

/**
 * Fixture artwork ships with the app and is read from disk. Operator uploads
 * (keys starting "upload/") live in the database so they survive serverless
 * hosts; uploads saved to disk before this change are still read from there.
 */
export class RoutedMediaStorage implements MediaStorage {
  constructor(private readonly db: BlobStore, private readonly local: MediaStorage) {}

  async read(storageKey: string) {
    if (storageKey.startsWith('upload/')) {
      const row = await this.db.mediaBlob.findUnique({ where: { storageKey } });
      if (row) return Buffer.from(row.data);
    }
    return this.local.read(storageKey);
  }

  async write(storageKey: string, data: Buffer) {
    if (!storageKey.startsWith('upload/')) return this.local.write(storageKey, data);
    const bytes = new Uint8Array(data);
    await this.db.mediaBlob.upsert({ where: { storageKey }, create: { storageKey, data: bytes }, update: { data: bytes } });
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
