import { PipeTransform } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';
import { Errors } from './errors';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) throw Errors.validation('Invalid request', { issues: r.error.issues });
    return r.data;
  }
}
