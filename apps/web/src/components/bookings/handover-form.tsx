'use client';

import { HandoverRequestSchema, type Booking, type HandoverRequest } from '@vrp/contracts';
import { useState, type FormEvent } from 'react';

import { FormField, FormMessage } from '@/components/auth/form-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FUEL_LEVEL_LABEL } from '@/lib/booking-labels';
import { fieldErrorsFromZod, submitErrorFrom, type FieldErrors } from '@/lib/forms';

const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-[3px]';

interface HandoverFormProps {
  kind: 'pickup' | 'return';
  booking: Booking;
  onSubmit: (body: HandoverRequest) => Promise<void>;
  onCancel: () => void;
}

/** Odometer / fuel / note for the pickup or return record (all optional). */
export function HandoverForm({ kind, booking, onSubmit, onCancel }: HandoverFormProps) {
  const [odometer, setOdometer] = useState('');
  const [fuel, setFuel] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const parsed = HandoverRequestSchema.safeParse({
      version: booking.version,
      odometerKm: odometer.trim() === '' ? null : Number(odometer),
      fuelLevel: fuel === '' ? null : Number(fuel),
      note: note.trim() === '' ? null : note.trim(),
    });
    if (!parsed.success) {
      setErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(parsed.data);
    } catch (caught) {
      setMessage(submitErrorFrom(caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4 rounded-md border p-4" onSubmit={(e) => void submit(e)} noValidate>
      <p className="text-sm font-medium">
        {kind === 'pickup' ? 'Record the handover' : 'Record the return'}
      </p>
      {message ? <FormMessage variant="destructive">{message}</FormMessage> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id={`${kind}-odometer`}
          label="Odometer (km, optional)"
          error={errors.odometerKm}
        >
          <Input
            id={`${kind}-odometer`}
            type="number"
            inputMode="numeric"
            min={0}
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
          />
        </FormField>
        <FormField id={`${kind}-fuel`} label="Fuel level (optional)" error={errors.fuelLevel}>
          <select
            id={`${kind}-fuel`}
            className={selectClass}
            value={fuel}
            onChange={(e) => setFuel(e.target.value)}
          >
            <option value="">Not recorded</option>
            {Object.entries(FUEL_LEVEL_LABEL).map(([level, label]) => (
              <option key={level} value={level}>
                {label}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <FormField
        id={`${kind}-note`}
        label="Note (optional, shared with the customer)"
        error={errors.note}
      >
        <Textarea
          id={`${kind}-note`}
          className="min-h-16"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : kind === 'pickup' ? 'Confirm pickup' : 'Confirm return'}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
