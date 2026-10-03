import type { Metadata } from 'next';

import { BecomeProviderCta } from '@/components/providers/become-provider-cta';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Become a provider',
  description:
    'List your cars, vans, SUVs or bikes for rent on the South Coast. Free to list; applications are reviewed by our team.',
};

const STEPS = [
  {
    title: '1. Create an account and verify your e-mail',
    body: 'Providers use the same account as customers. A verified e-mail address is required.',
  },
  {
    title: '2. Tell us about your rental business',
    body: 'Business name, contact person and phone number, where you operate from (Matara or Galle district for now), which vehicle types you offer, and a short description.',
  },
  {
    title: '3. Platform review',
    body: 'Our team reviews every application manually and may call or e-mail you to confirm details. No documents are uploaded at this stage; we will tell you if anything is needed.',
  },
  {
    title: '4. Start listing (coming next)',
    body: 'Approved providers get a provider dashboard. Vehicle listings, pricing and availability open in the next release.',
  },
];

export default function BecomeProviderPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <header className="space-y-3">
        <p className="text-muted-foreground text-sm font-medium">
          For rental businesses and vehicle owners
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Become a provider</h1>
        <p className="text-muted-foreground">
          Reach customers searching for vehicles on the South Coast with real availability and
          transparent pricing. Listing is free; the platform earns a commission only when a booking
          is confirmed.
        </p>
        <BecomeProviderCta />
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((step) => (
          <Card key={step.title}>
            <CardHeader>
              <CardTitle className="text-base">{step.title}</CardTitle>
              <CardDescription>{step.body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What “platform-approved” means</CardTitle>
          <CardDescription>
            Approval means our team has reviewed your application and confirmed your contact details
            and operating area with you directly. It is not a digital identity or document
            verification; stronger verification badges will come with document checks in a later
            release.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Launch area: Matara and Galle districts (Matara, Weligama, Mirissa, Galle, Unawatuna and
          nearby towns).
        </CardContent>
      </Card>
    </main>
  );
}
