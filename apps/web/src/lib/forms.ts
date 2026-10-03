import type { ZodError } from 'zod';

import { ApiClientError } from './api-client';

export type FieldErrors = Record<string, string>;

/** First issue per top-level field. */
export function fieldErrorsFromZod(error: ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '_');
    if (!(field in errors)) errors[field] = issue.message;
  }
  return errors;
}

export interface SubmitError {
  message: string;
  code?: string;
  fields: FieldErrors;
}

/** Normalises any thrown value into something a form can render. */
export function submitErrorFrom(error: unknown): SubmitError {
  if (error instanceof ApiClientError) {
    const fields: FieldErrors = {};
    for (const detail of error.details ?? []) {
      if (detail.field && !(detail.field in fields)) fields[detail.field] = detail.issue;
    }
    return { message: error.message, code: error.code, fields };
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return { message: 'The server took too long to respond. Please try again.', fields: {} };
  }
  return { message: 'Something went wrong. Please try again.', fields: {} };
}
