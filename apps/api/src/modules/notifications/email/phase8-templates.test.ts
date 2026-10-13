import { describe, expect, it } from 'vitest';

import {
  paymentReminderEmail,
  pickupReminderCustomerEmail,
  pickupReminderProviderEmail,
  reviewReminderEmail,
} from './reminder-templates';
import {
  reviewHiddenCustomerEmail,
  reviewReceivedProviderEmail,
  reviewReplyCustomerEmail,
} from './review-templates';
import { SMS_SEGMENT_LENGTH, SMS_TEMPLATES, renderSms } from './sms-templates';

const base = {
  to: 'nimal@example.com',
  fullName: 'Nimal Perera',
  reference: 'SLR-7F3K2Q',
  vehicleTitle: 'Toyota Aqua 2018',
  startsAt: new Date('2026-11-11T18:30:00Z'),
  endsAt: new Date('2026-11-14T18:30:00Z'),
  rentalDays: 3,
  subtotal: '22500.00',
  link: 'http://localhost:3000/bookings/x',
};

describe('Phase 8 e-mail templates', () => {
  it('payment reminder states the amount, the deadline and the link in text and HTML', () => {
    const mail = paymentReminderEmail({
      ...base,
      providerName: 'Sunil Rentals',
      advance: '2250.00',
      confirmBy: new Date('2026-11-05T04:30:00Z'),
    });
    expect(mail.subject).toContain('SLR-7F3K2Q');
    expect(mail.text).toContain('LKR 2,250');
    expect(mail.text).toContain('booking SLR-7F3K2Q');
    expect(mail.html).toContain('booking SLR-7F3K2Q');
    expect(mail.text).toContain('5 Nov 2026');
    expect(mail.html).toContain('Pay the advance');
    expect(mail.html).toContain(base.link);
  });

  it('pickup reminders carry the address for the customer and the customer name for the provider', () => {
    const customer = pickupReminderCustomerEmail({
      ...base,
      providerName: 'Sunil Rentals',
      pickupAddress: '12 Beach Road <b>Mirissa</b>',
      pickupInstructions: null,
      balanceDue: '20250.00',
      securityDeposit: '25000.00',
    });
    expect(customer.text).toContain('12 Beach Road <b>Mirissa</b>');
    expect(customer.html).toContain('12 Beach Road &lt;b&gt;Mirissa&lt;/b&gt;');
    expect(customer.text).toContain('LKR 20,250');
    const provider = pickupReminderProviderEmail({ ...base, customerName: 'Nimal Perera' });
    expect(provider.subject).toContain('handover');
    expect(provider.text).toContain('Nimal Perera');
  });

  it('review mails escape user text in HTML and keep it verbatim in plain text', () => {
    const received = reviewReceivedProviderEmail({
      ...base,
      reviewerName: 'Nimal P.',
      overallRating: 5,
      comment: 'Great <script>alert(1)</script>',
    });
    expect(received.text).toContain('Great <script>alert(1)</script>');
    expect(received.html).not.toContain('<script>');
    expect(received.html).toContain('&lt;script&gt;');
    expect(received.text).toContain('★★★★★');
    const reply = reviewReplyCustomerEmail({
      ...base,
      providerName: 'Sunil',
      reply: '<img src=x>',
    });
    expect(reply.html).toContain('&lt;img');
    const hidden = reviewHiddenCustomerEmail({ ...base, reason: 'Phone number in <comment>' });
    expect(hidden.html).toContain('&lt;comment&gt;');
    expect(hidden.text).toContain('Phone number in <comment>');
    const reminder = reviewReminderEmail({
      ...base,
      providerName: 'Sunil',
      windowClosesAt: new Date('2026-11-28T18:30:00Z'),
    });
    expect(reminder.subject).toContain('How was your rental');
    expect(reminder.text).toContain('29 Nov 2026');
  });
});

describe('SMS templates (provider-neutral, not sent in this release)', () => {
  it('every template is short, names the booking and carries the link only', () => {
    for (const key of Object.keys(SMS_TEMPLATES) as (keyof typeof SMS_TEMPLATES)[]) {
      const sms = renderSms(key, '+94771234567', {
        reference: 'SLR-7F3K2Q',
        when: '13 Nov 2026, 10:00',
        link: 'https://example.lk/b/abc',
      });
      expect(sms.text.length, key).toBeLessThanOrEqual(SMS_SEGMENT_LENGTH * 2);
      expect(sms.text).toContain('SLR-7F3K2Q');
      expect(sms.text).toContain('https://example.lk/b/abc');
      expect(sms.text).not.toMatch(/token|secret|LKR \d/);
      expect(sms.templateKey).toBe(key);
    }
  });
});
