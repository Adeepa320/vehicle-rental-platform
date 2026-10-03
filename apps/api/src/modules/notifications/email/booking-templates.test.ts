import { describe, expect, it } from 'vitest';

import {
  bookingAcceptedEmail,
  bookingConfirmedCustomerEmail,
  bookingDeclinedEmail,
  bookingRequestedProviderEmail,
  formatColombo,
} from './booking-templates';

const base = {
  to: 'sunil@example.com',
  fullName: 'Sunil <b>Rentals</b>',
  reference: 'SLR-7F3K2Q',
  vehicleTitle: 'Toyota Aqua 2018',
  startsAt: new Date('2026-11-12T03:30:00.000Z'),
  endsAt: new Date('2026-11-15T03:30:00.000Z'),
  rentalDays: 3,
  subtotal: '22500.00',
  link: 'http://localhost:3000/provider/bookings/abc',
};

describe('booking e-mail templates', () => {
  it('formats instants in Sri Lanka time', () => {
    expect(formatColombo('2026-11-12T03:30:00.000Z')).toContain('12 Nov 2026');
    expect(formatColombo('2026-11-12T03:30:00.000Z')).toContain('09:00');
  });

  it('tells the provider the deadline and includes the customer note safely', () => {
    const message = bookingRequestedProviderEmail({
      ...base,
      customerFirstName: 'Nimal',
      respondBy: new Date('2026-11-02T04:30:00.000Z'),
      customerNote: '<script>alert(1)</script> arriving by train',
    });
    expect(message.subject).toContain('SLR-7F3K2Q');
    expect(message.text).toContain('LKR 22,500');
    expect(message.text).toContain('2 Nov 2026, 10:00');
    expect(message.text).toContain('arriving by train');
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.html).toContain('&lt;b&gt;Rentals');
    expect(message.html).toContain(base.link);
  });

  it('explains the Phase 6 confirmation step without promising payment', () => {
    const message = bookingAcceptedEmail({
      ...base,
      providerName: 'Sunil Rentals',
      confirmBy: new Date('2026-11-03T04:30:00.000Z'),
      providerNote: null,
    });
    expect(message.text).toMatch(/online payment is not available yet/i);
    expect(message.text).not.toMatch(/pay now/i);
  });

  it('labels automatic declines differently from provider declines', () => {
    const auto = bookingDeclinedEmail({
      ...base,
      providerName: 'Sunil Rentals',
      reasonLabel: 'The vehicle was booked for overlapping dates',
      note: null,
      automatic: true,
    });
    const manual = bookingDeclinedEmail({
      ...base,
      providerName: 'Sunil Rentals',
      reasonLabel: 'Other reason',
      note: 'Sorry, family emergency',
      automatic: false,
    });
    expect(auto.text).toMatch(/closed automatically/);
    expect(manual.text).toMatch(/could not accept/);
    expect(manual.text).toContain('Sorry, family emergency');
  });

  it('shares the pickup address only in the confirmation e-mail', () => {
    const message = bookingConfirmedCustomerEmail({
      ...base,
      providerName: 'Sunil Rentals',
      pickupAddress: '12 Beach Road, Mirissa',
      pickupInstructions: 'Blue gate',
    });
    expect(message.text).toContain('12 Beach Road, Mirissa');
    expect(message.text).toContain('Blue gate');
    expect(message.text).toMatch(/phone number and e-mail are now visible/);
  });
});
