import { Controller, Get, Module, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { existsSync, mkdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import sharp from 'sharp';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RENDITION_WIDTHS } from '../catalogue/film-dto';
import { LocalMediaStorage, MediaStorage } from './storage';

/** Where fixture artwork and uploads live. In production this is object storage + CDN. */
export const MEDIA_ROOTS = {
  fixture: resolve(__dirname, '../../../shared/fixtures/artwork'),
  upload: resolve(__dirname, '../../.media/uploads'),
  cache: resolve(__dirname, '../../.media-cache'),
};

export const mediaStorage: MediaStorage = new LocalMediaStorage({ fixture: MEDIA_ROOTS.fixture, upload: MEDIA_ROOTS.upload });

/**
 * Image delivery: serves sized renditions (never upscaled, never stretched),
 * cached on disk and marked immutable since URLs carry a version parameter.
 * Cropping to a frame is done client-side using the asset's focal point.
 */
@ApiTags('Media')
@Controller('v1/media')
export class MediaController {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {
    mkdirSync(MEDIA_ROOTS.cache, { recursive: true });
  }

  @Get(':assetId')
  async get(@Param('assetId') id: string, @Query('w') w: string | undefined, @Res() res: Response) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw Errors.notFound('Image');
    if (asset.expiresAt && asset.expiresAt <= this.clock.now()) throw Errors.notFound('Image');

    const requested = Number(w) || asset.width;
    const width = RENDITION_WIDTHS.find((r) => r >= requested && r <= asset.width) ?? asset.width;
    const isPng = asset.mimeType === 'image/png';
    const cacheFile = join(MEDIA_ROOTS.cache, `${asset.id}-${asset.updatedAt.getTime()}-${width}.${isPng ? 'png' : 'jpg'}`);

    let body: Buffer;
    if (existsSync(cacheFile)) {
      body = await readFile(cacheFile);
    } else {
      const src = await mediaStorage.read(asset.storageKey);
      const pipeline = sharp(src).resize({ width, withoutEnlargement: true });
      body = isPng ? await pipeline.png().toBuffer() : await pipeline.jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer();
      await writeFile(cacheFile, body);
    }
    res.setHeader('Content-Type', isPng ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(body);
  }
}

@Module({ controllers: [MediaController] })
export class MediaModule {}
