import { describe, expect, it } from 'vitest';

import { passwordResetEmail, verificationEmail } from './templates';

describe('e-mail templates', () => {
  it('include the link in both text and HTML and escape user-controlled values', () => {
    const message = verificationEmail({
      to: 'nimal@example.com',
      fullName: '<script>alert(1)</script> Perera',
      link: 'http://localhost:3000/verify-email?token=abc',
      expiresInHours: 24,
    });
    expect(message.to).toBe('nimal@example.com');
    expect(message.text).toContain('http://localhost:3000/verify-email?token=abc');
    expect(message.html).toContain('http://localhost:3000/verify-email?token=abc');
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.text).toContain('24 hours');
  });

  it('states the reset expiry and the no-change guarantee', () => {
    const message = passwordResetEmail({
      to: 'nimal@example.com',
      fullName: 'Nimal',
      link: 'http://localhost:3000/reset-password?token=xyz',
      expiresInMinutes: 30,
    });
    expect(message.subject).toMatch(/reset/i);
    expect(message.text).toContain('30 minutes');
    expect(message.text).toMatch(/password will not change/);
  });
});
