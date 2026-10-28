import { BadgeCheck, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

/**
 * Public trust wording, unchanged: "Platform-approved provider" means the team
 * reviewed the application; "Verified provider" / "Verified vehicle" only when
 * the Phase 9 documents are approved and in date (`documentsVerified`).
 */
export function ProviderTrustBadge({ documentsVerified }: { documentsVerified: boolean }) {
  return (
    <Badge variant="success" className="h-6 px-2.5">
      <ShieldCheck aria-hidden />
      {documentsVerified ? 'Verified provider' : 'Platform-approved provider'}
    </Badge>
  );
}

export function VehicleVerifiedBadge() {
  return (
    <Badge variant="success" className="h-6 px-2.5">
      <BadgeCheck aria-hidden />
      Verified vehicle
    </Badge>
  );
}
