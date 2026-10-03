import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiException } from '../errors/api.exception';
import { ZodValidationPipe } from './zod-validation.pipe';

const schema = z.object({
  name: z.string().min(2),
  seats: z.coerce.number().int().positive().default(4),
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value with defaults and coercion applied', () => {
    expect(pipe.transform({ name: 'Aqua', seats: '5' }, { type: 'body' })).toEqual({
      name: 'Aqua',
      seats: 5,
    });
    expect(pipe.transform({ name: 'Aqua' }, { type: 'body' })).toEqual({ name: 'Aqua', seats: 4 });
  });

  it('throws a VALIDATION_ERROR ApiException listing each field issue', () => {
    let caught: unknown;
    try {
      pipe.transform({ name: 'A', seats: -1 }, { type: 'body' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiException);
    const exception = caught as ApiException;
    expect(exception.getStatus()).toBe(400);
    expect(exception.code).toBe('VALIDATION_ERROR');
    expect(exception.message).toBe('Invalid request body');
    expect(exception.details?.map((d) => d.field).sort()).toEqual(['name', 'seats']);
  });
});
