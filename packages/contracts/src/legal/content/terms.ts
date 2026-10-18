import { CURRENT_TERMS_VERSION } from '../../auth/auth';
import type { LegalDocument } from '../legal';

/**
 * Terms of Service (Phase 10 draft, TECH_DECISIONS D70). Product facts come
 * from docs/PRD.md, docs/USER_FLOWS.md and the implemented booking, payment,
 * review and dispute modules; every statement of law is a placeholder or
 * marked for legal review. Licensing statements defer to
 * `src/guidance/licensing.ts` and never state the law as fact.
 */
export const TERMS_OF_SERVICE: LegalDocument = {
  id: 'terms',
  title: 'Terms of Service',
  version: CURRENT_TERMS_VERSION,
  status: 'draft',
  lastUpdated: '2026-10-17',
  effectiveFrom: null,
  summary:
    'These terms govern the use of the vehicle rental marketplace operated by [PLACEHOLDER: CONTROLLER_NAME the operating company]. They are a draft and have not been approved for publication. [LEGAL REVIEW REQUIRED]',
  approvalRequiredFrom: ['Founder', 'Sri Lankan legal counsel'],
  sections: [
    {
      id: 'who-we-are',
      heading: 'Who we are and what the platform does',
      paragraphs: [
        'The platform is operated by [PLACEHOLDER: CONTROLLER_NAME the legal entity], company registration number [PLACEHOLDER: COMPANY_REGISTRATION_NUMBER], registered address [PLACEHOLDER: REGISTERED_ADDRESS]. In these terms, "we", "us" and "the platform" refer to that entity and to the website and application it operates.',
        'The platform is an online marketplace. It lets vehicle owners and rental businesses ("providers") list vehicles for rent and lets customers find vehicles, see their availability, compare prices, send booking requests and pay an advance online.',
        'We are an intermediary. We do not own, operate, insure or hand over the vehicles. The rental agreement for a vehicle is between the customer and the provider. We are not a party to it and we are not a rental company, a carrier, a travel agent or an insurer. [LEGAL REVIEW REQUIRED]',
      ],
      bullets: [],
    },
    {
      id: 'definitions',
      heading: 'Definitions',
      paragraphs: [],
      bullets: [
        'Customer: a person who uses the platform to find and book a vehicle.',
        'Provider: a person or business whose application to list vehicles has been approved by the platform.',
        'Listing: the description, photos, prices and availability of a vehicle published by a provider.',
        'Booking request: a request sent by a customer for a listing and dates. It does not reserve the vehicle.',
        'Accepted booking: a booking request the provider has accepted. The vehicle is reserved from this moment.',
        'Confirmed booking: an accepted booking for which the advance has been paid and verified.',
        'Advance: the part of the rental total paid online through the platform after acceptance (10 percent of the rental total in this release).',
        'Balance: the rest of the rental total, paid to the provider at pickup.',
        'Deposit: the refundable security deposit stated on the listing, paid to and returned by the provider.',
        'Cancellation and Refund Policy: the separate policy that forms part of these terms.',
        'Privacy Notice: the separate notice explaining how personal data is processed.',
      ],
    },
    {
      id: 'eligibility-and-accounts',
      heading: 'Eligibility and accounts',
      paragraphs: [
        'You must be at least 18 years old to create an account or to use the platform. By creating an account you confirm that you are 18 or older and that the information you give is accurate and kept up to date.',
        'An account is personal. Keep your password confidential, do not share your account and tell us at once at [PLACEHOLDER: SUPPORT_EMAIL the support inbox] if you suspect unauthorised use. You are responsible for activity on your account until you tell us.',
        'We may refuse, suspend or close an account as described in the section on suspension and termination. Accounts used by the platform team are protected by a second authentication factor; we may extend this requirement to other accounts.',
      ],
      bullets: [],
    },
    {
      id: 'provider-obligations',
      heading: 'Provider obligations',
      paragraphs: [
        'Providers apply to join the platform and are reviewed by the platform team before any listing is published. Providers also accept a provider agreement when they apply; its version is recorded on the application. Approval means that the platform has reviewed the application; it is not a guarantee by us of the provider or the vehicle.',
      ],
      bullets: [
        'List only vehicles you have the legal right to rent out, with accurate make, model, year, category, seats, transmission, fuel, registration details, photos, prices and pickup locations. Identity details of a vehicle are locked after approval and can be changed only through the platform team.',
        'Keep the certificate of registration, revenue licence and insurance of each listed vehicle current, and upload renewals before expiry. A listing may be paused automatically when an approved revenue licence or insurance certificate expires.',
        'Keep availability accurate. Block dates on which the vehicle is not available. Accepting a request means you commit to hand over that vehicle, or an agreed equivalent, for those dates.',
        'Respond to booking requests within the response window shown on the request (24 hours or less in this release).',
        'Check the physical driving licence of the driver at pickup and refuse the handover if it is missing, expired or not valid for the vehicle class. The platform does not verify licences.',
        'Collect the balance and the deposit at pickup only as stated on the listing, give the customer a receipt where required by law, and return the deposit after the rental under the terms agreed with the customer.',
        'Explain to the customer what the insurance covers and what the customer is liable for before handover.',
        'Treat customers fairly and lawfully, keep their personal data confidential and use their contact details only for the booking.',
        'Comply with all laws that apply to renting out vehicles in Sri Lanka, including registration, licensing, tax and tourism rules. [LEGAL REVIEW REQUIRED]',
      ],
    },
    {
      id: 'customer-obligations',
      heading: 'Customer obligations',
      paragraphs: [],
      bullets: [
        'Give accurate details for the person who will drive: full name, country of residence, the country that issued the licence and its expiry date. The platform does not collect licence numbers or copies of documents.',
        'Hold, and bring to the pickup, a physical driving licence that is valid for the vehicle class on the day of pickup, together with any permit required for foreign licence holders. See the section on licence requirements.',
        'Be at the pickup location at the agreed time or tell the provider in advance. A provider may record a no-show once the grace period has passed.',
        'Pay the balance and the deposit to the provider at pickup as stated on the listing, and use the vehicle lawfully, carefully and only as agreed with the provider.',
        'Return the vehicle at the agreed time and place in the condition agreed with the provider. Fuel, damage, fines, tolls and late return are settled directly with the provider.',
        'Do not ask the provider to cancel a booking in order to avoid this platform or its policies.',
      ],
    },
    {
      id: 'licence-requirements',
      heading: 'Licence requirements and tourist guidance',
      paragraphs: [
        'Driving licence rules in Sri Lanka are set and applied by the Department of Motor Traffic and the police, and they change. The licence guidance shown on listings and booking pages is informational only and is not legal advice; several items are marked "confirm before travelling" because they restate reported rules that the platform has not been able to confirm from a primary source.',
        'It is your responsibility to confirm the current requirements before you travel and to hold a licence that is valid for the vehicle class on the day of pickup. The provider checks the physical licence at pickup and may refuse the handover. The platform does not determine whether you are entitled to drive.',
        'Three-wheelers and scooters are not offered for self-drive on the platform in this release.',
      ],
      bullets: [],
    },
    {
      id: 'listings-and-information',
      heading: 'Listings, prices and trust information',
      paragraphs: [
        'Listing content is created by providers. We review listings before publication and may ask for changes, pause or remove a listing, but we do not inspect vehicles and we do not guarantee that a listing is accurate or that a vehicle is roadworthy or insured.',
        'Prices are set by providers in Sri Lankan rupees. The price shown in search results before you choose dates is an estimate; the price shown on a quote and on a booking request is fixed for that booking when the request is sent and is not changed afterwards. Amounts shown in other currencies are indicative conversions for information only; every payment is made in Sri Lankan rupees.',
        'The map shows an approximate pickup area for a listing. The exact pickup address and instructions are shown only once a booking is confirmed.',
        'The words "Approved provider" and "Platform-reviewed" mean that the platform has reviewed the provider application. A "Verified" badge on a provider or a vehicle means that the relevant documents have been reviewed by the platform and are in date. Neither is a guarantee of the provider, the vehicle or its insurance.',
      ],
      bullets: [],
    },
    {
      id: 'booking-process',
      heading: 'Booking requests and acceptance',
      paragraphs: [
        'Sending a booking request does not reserve the vehicle. The provider may accept or decline within the response window (24 hours or less, depending on the pickup time); a request that is not answered in time expires. The vehicle is reserved only when the provider accepts.',
        'After acceptance you have a payment window (24 hours or less, depending on the pickup time) to pay the advance. The booking is confirmed when the payment gateway has verified the payment. If the advance is not paid in time, the booking expires and the vehicle is released.',
        'The price, the advance and the payment deadline are fixed on the booking when the request is sent and are shown on the booking page.',
      ],
      bullets: [],
    },
    {
      id: 'payment',
      heading: 'Payment of the advance',
      paragraphs: [
        'The advance is paid online through the payment gateway PayHere on its hosted payment page. Your card or wallet details are entered on the gateway page and never pass through or are stored by the platform. We receive the result of the payment, the gateway reference and the payment method.',
        'The advance is 10 percent of the rental total in this release and is retained by the platform as its service fee for arranging the booking. The provider receives the balance from you directly at pickup. The tax and invoicing treatment of the advance is under legal review. [LEGAL REVIEW REQUIRED]',
        'The platform does not collect the balance or the deposit and does not pay providers. Receipts for the balance and the deposit are issued by the provider.',
      ],
      bullets: [],
    },
    {
      id: 'cancellation-expiry-no-show',
      heading: 'Cancellation, expiry and no-show',
      paragraphs: [
        'The Cancellation and Refund Policy forms part of these terms and sets out when the advance is refunded, when it is forfeited and how refunds are processed. In summary: a request may be withdrawn at no cost before acceptance; an accepted booking may be cancelled at no cost before payment; after payment, a customer cancellation at least 48 hours before pickup gives a full refund of the advance and a later cancellation forfeits it; a cancellation by the provider or by the platform gives a full refund.',
        'Refunds are processed by the platform team and recorded on the booking; they are not automatic. A payment that arrives after a booking has expired or been cancelled does not reinstate the booking and is refunded.',
        'A provider may record a no-show from 3 hours after the pickup time. The advance is not refunded automatically after a no-show; see the policy.',
      ],
      bullets: [],
    },
    {
      id: 'pickup-and-return',
      heading: 'Pickup and return',
      paragraphs: [
        'The provider records the handover and the return on the platform, with optional notes that the other party can see. Check the vehicle together at pickup and at return and agree in writing, for example by message or photo, on its condition, fuel level and mileage.',
        'Extra charges after the rental, such as fuel, damage, cleaning, fines or late return, are a matter between you and the provider. The platform does not calculate, collect or arbitrate them, although either party may open a dispute to record the disagreement.',
      ],
      bullets: [],
    },
    {
      id: 'contact-details',
      heading: 'Contact details and communication',
      paragraphs: [
        'The telephone number, e-mail address and messaging link of the other party are revealed only once a booking is confirmed, and each reveal is logged. Use these details only for the booking concerned. Do not add the other party to marketing lists, share their details or contact them for unrelated purposes.',
        'The platform sends transactional e-mails and in-app notifications about your account and bookings. It does not send marketing messages in this release.',
      ],
      bullets: [],
    },
    {
      id: 'reviews',
      heading: 'Reviews',
      paragraphs: [
        'A customer may leave one review for each completed booking within 14 days after completion. Reviews are published immediately and show the reviewer as first name and initial. A provider may post one public reply; after the reply the review can no longer be edited.',
        'Reviews must be truthful, based on your own experience and free of personal data of others, offensive content or unrelated material. We may hide a review that breaches these rules and we record the reason. Ratings shown on listings are computed from published reviews and are not edited by hand.',
      ],
      bullets: [],
    },
    {
      id: 'disputes',
      heading: 'Disputes between customers and providers',
      paragraphs: [
        'Either party to a booking may open one dispute per booking within 14 days after the booking was completed, recorded as a no-show or cancelled. Both parties and the platform team can post messages in the dispute thread, and the team gives a decision with a public note.',
        'The decision of the platform team is an operational decision about the use of the platform. It does not move money by itself: where a refund of the advance is appropriate it is processed and recorded under the Cancellation and Refund Policy. The dispute process is voluntary and does not replace your legal rights or remedies. [LEGAL REVIEW REQUIRED]',
      ],
      bullets: [],
    },
    {
      id: 'prohibited-conduct',
      heading: 'Prohibited conduct',
      paragraphs: [],
      bullets: [
        'Giving false information, uploading forged or altered documents, or impersonating another person or business.',
        'Listing a vehicle you are not entitled to rent out, or renting a vehicle to a person who is not entitled to drive it.',
        'Using the platform to arrange a rental and then moving the booking off the platform to avoid its policies.',
        'Harassing, threatening or discriminating against other users or the platform team.',
        'Scraping, probing, overloading or interfering with the platform, its security measures or its payment flows, or accessing accounts or data that are not yours.',
        'Posting unlawful, defamatory or infringing content, or content containing the personal data of others without their consent.',
      ],
    },
    {
      id: 'suspension-and-termination',
      heading: 'Suspension, termination and account deletion',
      paragraphs: [
        'We may suspend an account, pause or remove a listing, or cancel a booking where we reasonably believe these terms have been breached, where a safety or fraud concern exists, where documents have expired or where the law requires it. A suspension signs the account out of every session. We give a reason where we can do so without prejudicing an investigation.',
        'You may stop using the platform at any time and may request the deletion of your account from your account page. Deletion is carried out as anonymisation: your personal details are removed or replaced, while booking, payment, review, dispute and audit records are kept in anonymised form for the periods described in the Privacy Notice. Deletion cannot be completed while you have an open booking, an open dispute, an unresolved payment or a refund due. [LEGAL REVIEW REQUIRED]',
        'Sections that by their nature should survive, including payment, liability, governing law and record keeping, continue to apply after an account is closed.',
      ],
      bullets: [],
    },
    {
      id: 'content-and-intellectual-property',
      heading: 'Content and intellectual property',
      paragraphs: [
        'You keep the rights in the photos, descriptions, reviews and messages you post. You grant the platform a non-exclusive, royalty-free licence to host, display, resize and distribute that content for the purpose of operating and promoting the marketplace, for as long as it is on the platform and for the retention periods described in the Privacy Notice. [LEGAL REVIEW REQUIRED]',
        'The platform, its software, design and trade marks belong to [PLACEHOLDER: CONTROLLER_NAME the operating company] or its licensors. Map data is provided by third parties under their own licences, which are credited on the map.',
      ],
      bullets: [],
    },
    {
      id: 'disclaimers',
      heading: 'Disclaimers',
      paragraphs: [
        'The platform is provided on an "as is" and "as available" basis. We do not guarantee that a vehicle will be available, roadworthy, insured or as described, that a provider or customer will perform, or that the platform will be uninterrupted or error-free.',
        '[PLACEHOLDER: DISCLAIMER_CLAUSE the full disclaimer wording to be provided by counsel] [LEGAL REVIEW REQUIRED]',
      ],
      bullets: [],
    },
    {
      id: 'limitation-of-liability',
      heading: 'Limitation of liability',
      paragraphs: [
        '[PLACEHOLDER: LIMITATION_OF_LIABILITY_CLAUSE the limitation of liability wording to be provided by counsel, including any cap and the exclusions that applicable law does not permit] [LEGAL REVIEW REQUIRED]',
      ],
      bullets: [],
    },
    {
      id: 'indemnity',
      heading: 'Indemnity',
      paragraphs: [
        '[PLACEHOLDER: INDEMNITY_CLAUSE the indemnity wording to be provided by counsel] [LEGAL REVIEW REQUIRED]',
      ],
      bullets: [],
    },
    {
      id: 'governing-law',
      heading: 'Governing law and disputes with the platform',
      paragraphs: [
        '[PLACEHOLDER: GOVERNING_LAW_CLAUSE the governing law and jurisdiction clause to be provided by counsel; Sri Lankan law and courts are expected] [LEGAL REVIEW REQUIRED]',
        'Nothing in these terms limits rights that you have under consumer protection or other laws that cannot be excluded by agreement. [LEGAL REVIEW REQUIRED]',
      ],
      bullets: [],
    },
    {
      id: 'changes-to-these-terms',
      heading: 'Changes to these terms',
      paragraphs: [
        'These terms carry a version, which is recorded on your account when you accept them. We may change the terms; the new version is published on this page with a new effective date and account holders are told before it applies. Continuing to use the platform after the effective date means you accept the new version. [LEGAL REVIEW REQUIRED]',
      ],
      bullets: [],
    },
    {
      id: 'contact',
      heading: 'Contact',
      paragraphs: [
        'Support: [PLACEHOLDER: SUPPORT_EMAIL the support inbox]. Privacy: [PLACEHOLDER: PRIVACY_CONTACT_EMAIL the privacy contact]. Postal address: [PLACEHOLDER: REGISTERED_ADDRESS].',
      ],
      bullets: [],
    },
  ],
};
