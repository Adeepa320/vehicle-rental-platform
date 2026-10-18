import { CURRENT_CANCELLATION_POLICY_VERSION, type LegalDocument } from '../legal';

/**
 * Cancellation and refund policy (Phase 10 draft, TECH_DECISIONS D56 / D70).
 * Every rule below restates what the code does today:
 * `cancellationRefundDecision` in `apps/api/src/modules/payments/payment.persistence.ts`,
 * the booking state machine in `apps/api/src/modules/bookings/booking.state.ts`
 * and the seeded defaults in `packages/database/src/seed/data/platform-settings.ts`
 * (`cancellation_full_refund_hours` 48, `payment_window_hours` 24,
 * `provider_response_hours` 24, `no_show_grace_hours` 3, `dispute_window_days` 14,
 * `advance_percentage` 10). Changing a rule here without changing the code, or
 * the other way round, is a drift (guarded by `src/__tests__/legal.test.ts`);
 * changing the rule itself needs explicit confirmation (CLAUDE.md §10).
 */
export const CANCELLATION_POLICY: LegalDocument = {
  id: 'cancellation-policy',
  title: 'Cancellation and Refund Policy',
  version: CURRENT_CANCELLATION_POLICY_VERSION,
  status: 'draft',
  lastUpdated: '2026-10-17',
  effectiveFrom: null,
  summary:
    'This policy explains what happens to the online advance when a booking is cancelled, expires or is not honoured, who decides and how a refund reaches you. It is a draft prepared by [PLACEHOLDER: CONTROLLER_NAME the operating company] and has not been approved for publication. [LEGAL REVIEW REQUIRED]',
  approvalRequiredFrom: ['Founder', 'Sri Lankan legal counsel'],
  sections: [
    {
      id: 'scope',
      heading: 'What this policy covers',
      paragraphs: [
        'This policy covers only the online advance paid through the platform. The balance of the rental price and any refundable security deposit are paid directly to the provider at pickup and are governed by the arrangement between you and the provider, not by this policy.',
        'The platform operates as a marketplace. The rental contract is between the customer and the provider. The platform applies the rules below to the advance it has collected and does not decide claims about damage, fuel, late return or other matters between the parties.',
        'The rules below are the same for every vehicle and every provider in this release. Provider-specific cancellation terms are not offered.',
      ],
      bullets: [],
    },
    {
      id: 'key-terms',
      heading: 'Key terms',
      paragraphs: [],
      bullets: [
        'Advance: the part of the rental total that is paid online after the provider accepts a request. In this release the advance is 10 percent of the rental total, rounded half up to the nearest cent, and is shown before you pay.',
        'Pickup time: the start time of the booking as shown on the booking page, in Sri Lanka time (Asia/Colombo).',
        'Hours before pickup: the time between the moment a cancellation is recorded by the platform and the pickup time.',
        'Refund due: the platform has decided that the advance must be returned to you and has queued it for the team to process. A refund due is not yet a refund made.',
        'Forfeited: the advance is kept under this policy and is not returned.',
      ],
    },
    {
      id: 'before-acceptance',
      heading: 'Before the provider accepts',
      paragraphs: [
        'A booking request does not reserve the vehicle and nothing is paid. You may withdraw a request at any time while it is waiting for the provider. There is nothing to refund.',
        'A provider has 24 hours to accept or decline a request, or less when the pickup time is sooner. A request that is not answered in time expires automatically and nothing is charged.',
      ],
      bullets: [],
    },
    {
      id: 'after-acceptance-before-payment',
      heading: 'After acceptance, before you pay',
      paragraphs: [
        'When the provider accepts, the vehicle is reserved for you and you have 24 hours to pay the advance, or less when the pickup time is sooner. The deadline is shown on the booking page.',
        'You may cancel during this time at no cost. The reservation is released and any payment attempt that is still in progress is cancelled on our side.',
        'If the advance is not paid by the deadline, the booking expires and the vehicle is released. Nothing is charged. If a payment nevertheless arrives after the deadline, the rules in the section on late payments apply.',
      ],
      bullets: [],
    },
    {
      id: 'customer-cancellation-after-payment',
      heading: 'Cancellation by the customer after payment',
      paragraphs: [
        'Once the advance has been paid the booking is confirmed. If you cancel a confirmed booking, the advance is treated as follows.',
        'The 48 hour threshold is a platform setting (cancellation_full_refund_hours). The value in force at the moment the cancellation is recorded is the value applied, and it is written into the record of the decision. Any change to this threshold will be announced in a new version of this policy before it is applied. [LEGAL REVIEW REQUIRED]',
        'No other cancellation charge is made by the platform. The balance and the deposit were never collected by the platform, so there is nothing further to refund or to charge.',
      ],
      bullets: [
        'Cancelled at least 48 hours before the pickup time: a full refund of the advance is due.',
        'Cancelled less than 48 hours before the pickup time: the advance is forfeited and no refund is due.',
      ],
    },
    {
      id: 'provider-cancellation',
      heading: 'Cancellation by the provider',
      paragraphs: [
        'If the provider cancels an accepted or confirmed booking, you are entitled to a full refund of any advance you paid, regardless of how close to the pickup time the cancellation happens.',
        'The platform records the cancellation on the provider account. Repeated cancellations may lead to the suspension of the provider under the Terms of Service.',
      ],
      bullets: [],
    },
    {
      id: 'platform-cancellation',
      heading: 'Cancellation by the platform',
      paragraphs: [
        'The platform team may cancel a booking for operational reasons, for example when a listing is withdrawn, a safety concern arises or a party cannot be reached. A cancellation made by the platform entitles you to a full refund of any advance you paid.',
        'When the team records a cancellation at the request of a customer, the customer rules above apply, including the 48 hour threshold. When the team records a cancellation at the request of, or because of, the provider, the provider rules apply and a full refund is due.',
        'A booking that is already in progress (the vehicle has been handed over) is not cancelled by the platform; it is completed by the provider when the vehicle is returned.',
      ],
      bullets: [],
    },
    {
      id: 'how-refunds-are-made',
      heading: 'How a refund due is paid',
      paragraphs: [
        'Refunds are not automatic. When a refund is due, the booking shows the status Refund due and a member of the team processes it. The team then records the refund on the platform, and the booking shows Advance refunded. You receive an e-mail when the refund is recorded.',
        'Card payments are refunded through the payment gateway (PayHere), either from the merchant portal or, where the gateway refund service has been enabled for the platform, by an instruction sent from the platform. Payments made with mobile wallets or bank transfer methods cannot be refunded through the gateway and are returned by bank transfer; in that case the team will ask you by e-mail for the account to pay into. Bank details collected for a refund are not stored on the platform.',
        'The platform aims to process a refund due within [PLACEHOLDER: REFUND_PROCESSING_TARGET_DAYS working days]. How long the money then takes to appear depends on the gateway and your bank; PayHere states that a refund made on the day of payment is reversed immediately and a later refund can take five to ten days or longer. [LEGAL REVIEW REQUIRED]',
        'The amount refunded is the full advance. The platform does not deduct a processing fee from a refund that is due under this policy.',
      ],
      bullets: [],
    },
    {
      id: 'late-payments',
      heading: 'Payments that arrive after a booking has closed',
      paragraphs: [
        'A payment can occasionally be confirmed by the gateway after the booking it belongs to has already expired or been cancelled. In that case the booking is not reinstated and the vehicle is not reserved, because the dates may already have been given to someone else.',
        'The payment is recorded, marked for the team and the full amount becomes a refund due, which is paid as described above. You are notified by e-mail. If you still want the vehicle, please send a new booking request.',
      ],
      bullets: [],
    },
    {
      id: 'no-show',
      heading: 'No-show at pickup',
      paragraphs: [
        'If you do not appear for a confirmed booking, the provider may record a no-show once 3 hours have passed after the pickup time and after noting the attempts made to contact you. The reservation is released.',
        'The advance is not refunded automatically after a no-show. If you believe the no-show was recorded wrongly, you may open a dispute within 14 days; any refund in that case is a manual decision by the platform team and is recorded in the same way as other refunds. [LEGAL REVIEW REQUIRED]',
      ],
      bullets: [],
    },
    {
      id: 'handover-refused',
      heading: 'Handover refused at pickup',
      paragraphs: [
        'The provider checks the physical driving licence at pickup and may refuse the handover if the licence is missing, expired or not valid for the vehicle class. The treatment of the advance in that situation is not yet settled and is under legal review; until it is, such cases are handled individually by the platform team through the dispute process. [LEGAL REVIEW REQUIRED]',
      ],
      bullets: [],
    },
    {
      id: 'disputes',
      heading: 'Disputes',
      paragraphs: [
        'Either party may open one dispute per booking within 14 days after the booking was completed, recorded as a no-show or cancelled. The platform team reviews the thread and gives a decision with a public note.',
        'A dispute decision never moves money by itself. Where the team concludes that a refund should be made, it is processed and recorded under the rules above. The dispute process does not limit any rights you may have under applicable law. [LEGAL REVIEW REQUIRED]',
      ],
      bullets: [],
    },
    {
      id: 'balance-and-deposit',
      heading: 'Balance and security deposit',
      paragraphs: [
        'The balance of the rental price and the refundable security deposit shown on the listing are paid to the provider at pickup, by the methods the provider accepts. The deposit is returned by the provider after the rental under the terms agreed with the provider. The platform does not hold, collect or refund these amounts.',
      ],
      bullets: [],
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      paragraphs: [
        'This policy carries a version. The platform may change it; the new version is published on this page with a new effective date and announced to account holders before it applies. [LEGAL REVIEW REQUIRED]',
        'Questions about a refund can be sent to [PLACEHOLDER: SUPPORT_EMAIL the support inbox]. Please quote the booking reference.',
      ],
      bullets: [],
    },
  ],
};
