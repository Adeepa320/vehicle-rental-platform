# Privacy Notice

**Status:** DRAFT — not approved for publication · **Version:** 2026-10 · **Last updated:** 2026-10-17

> Generated from `packages/contracts/src/legal/content/privacy-notice.ts` by `pnpm legal:render`; edit the source, not this file. Approval required from: Founder, Sri Lankan legal counsel.

This notice explains what personal data [PLACEHOLDER: CONTROLLER_NAME the operating company] collects when you use the vehicle rental marketplace, why, who receives it, how long it is kept and what rights you have. It is a draft and has not been approved for publication. [LEGAL REVIEW REQUIRED]

**Open before approval:** LEGAL_REVIEW_REQUIRED, PLACEHOLDER:COMPANY_REGISTRATION_NUMBER, PLACEHOLDER:CONTROLLER_NAME, PLACEHOLDER:DPO_CONTACT, PLACEHOLDER:PRIVACY_CONTACT_EMAIL, PLACEHOLDER:REGISTERED_ADDRESS, PLACEHOLDER:SUPPORT_EMAIL

## 1. Who is responsible for your data

The controller of the personal data described in this notice is [PLACEHOLDER: CONTROLLER_NAME the legal entity], company registration number [PLACEHOLDER: COMPANY_REGISTRATION_NUMBER], registered address [PLACEHOLDER: REGISTERED_ADDRESS].

Privacy questions and requests: [PLACEHOLDER: PRIVACY_CONTACT_EMAIL the privacy contact address]. Data protection officer: [PLACEHOLDER: DPO_CONTACT the officer, or a statement that none has been appointed]. Whether the platform must appoint a data protection officer under the Personal Data Protection Act depends on thresholds that have only been published in draft; this is under legal review. [LEGAL REVIEW REQUIRED]

## 2. What this notice covers

This notice covers the website, the application programming interface used by the website, the e-mails and in-app notifications we send, and the platform team tools used to operate the marketplace. It applies to visitors, customers, providers and the people providers name as contacts.

Providers who receive your details for a booking are responsible for their own use of those details. The payment gateway processes your card or wallet details under its own privacy terms.

## 3. What personal data we collect

We collect only what each function needs. The categories below describe what the platform stores today.

- Account data: e-mail address, full name, optional telephone number, optional country of residence, preferred language and display currency, password (stored only as a salted hash), the versions of the terms and this notice you accepted, and the times of registration, e-mail verification and last login.
- Session and security data: for each sign-in, a hashed session token with the device type, browser identification string and network address; one-time tokens for e-mail verification and password reset with the requesting network address; for platform team accounts, an encrypted authenticator secret and hashed recovery codes.
- Provider application and profile data: business or display name, contact name, telephone and messaging numbers, address, district, website, description, categories offered, notes to the platform team, and the provider agreement version accepted. Approved providers also have pickup locations with an address, an optional map pin and pickup instructions.
- Verification documents: identity document, business registration and, per vehicle, certificate of registration, revenue licence, insurance certificate and emission certificate, uploaded as PDF or image files, with the document number, issue and expiry dates the provider enters. These are kept in private storage.
- Vehicle data: make, model, year, registration number (never shown publicly), specifications, prices, photos and availability blocks. Photos are re-encoded and stripped of embedded metadata such as location before they are published.
- Booking data: the dates, pickup location, price snapshot, the driver details you enter (full name, optional country of residence, the country that issued the licence and its expiry date), notes you and the provider write for each other, the booking timeline and a record of each time contact details were revealed. We do not collect licence numbers, identity card or passport numbers or copies of documents from customers.
- Payment data: the booking reference, the amount and currency, the gateway order and payment identifiers, the payment status, the payment method name and a log of gateway notifications limited to codes, identifiers, amounts and reasons. We never receive your full card number and we do not store card numbers, cardholder names or expiry dates, even in masked form.
- Reviews, replies and disputes: your rating and comment, provider replies, dispute reasons, descriptions and messages, together with the platform team decisions.
- Notifications: the in-app notifications and e-mails we have sent you about your account and bookings.
- Requests to us: data-subject requests (access or deletion), support correspondence and notes the platform team keeps about handling them.
- Technical logs: request logs with a request identifier, path, status, timing, network address and browser identification string; audit records of actions taken by providers and the platform team, which include the network address of the actor; anonymous search statistics (place, district, category, dates, filters and result count) that contain no network address, account or coordinates.

## 4. Where the data comes from

- From you, when you register, apply as a provider, list a vehicle, send a booking request, pay, write a review or message, or contact us.
- From the other party to a booking, when a provider records a handover, return or no-show with notes, or when a customer leaves a review.
- From the payment gateway, which tells us the result of a payment you made on its page.
- Automatically, from your browser and device when you use the platform (request logs, session data).

## 5. Why we process your data

Each purpose below rests on a lawful basis under the Personal Data Protection Act, which will be stated here once legal counsel has confirmed the mapping of purposes to the grounds in the Act. [LEGAL REVIEW REQUIRED]

- Providing the marketplace: accounts, search, listings, booking requests, acceptance, payment of the advance, handover records, reviews and disputes.
- Communicating about your account and bookings: verification and password e-mails, booking status e-mails and in-app notifications, payment and pickup reminders, review reminders and refund notices. We do not send marketing messages in this release.
- Trust and safety: reviewing provider applications, listings and documents; publishing approved listings and in-date document badges; suspending accounts or listings; investigating disputes and complaints.
- Payments: creating the gateway checkout, verifying gateway notifications, detecting duplicate, late or mismatched payments and recording refunds.
- Security and abuse prevention: authentication, session management, rate limiting, audit trails, fraud and forgery detection.
- Legal and financial record keeping: keeping booking, payment and audit records for the periods described in the retention section.
- Improving the service: anonymous search statistics (which places, categories and dates are searched and how many results were returned). No individual usage profiles are built.

## 6. What the other party to a booking sees

Before a booking is confirmed, a provider sees your name, the driver details you entered and your notes, and you see the provider display name, the approximate pickup area and the listing. Telephone numbers, e-mail addresses and messaging links are revealed to both parties only once the booking is confirmed, and each reveal is recorded.

Public pages show only what a provider has chosen to publish: the listing, approximate location, prices, photos, the provider display name and published reviews. Reviews show the reviewer as first name and initial. Registration numbers, exact addresses, pickup instructions and contact details are never shown publicly.

## 7. Service providers who process data for us

We use the following companies to run the platform. Each acts on our instructions as a processor, except where stated. The full register, including contract status, is kept in our processor register and updated when a provider changes. Contracts with these providers have not yet been executed at the date of this draft. [LEGAL REVIEW REQUIRED]

- Railway (application hosting, Singapore region): runs the web application, the API and the background worker; processes every category of data in transit and in memory, and holds application logs.
- Neon or Supabase (managed PostgreSQL database, Singapore region; the choice between them is not yet made): stores the database described above, including backups.
- Cloudflare, Inc. (domain name system, web application firewall, content delivery and object storage known as R2): sees the network address and request data of every visitor at the edge; stores vehicle photos (public variants and private originals) and private verification documents in object storage. Cloudflare does not offer a guaranteed Asian storage location; the location of stored objects is a best-effort preference. [LEGAL REVIEW REQUIRED]
- PayHere (Private) Limited (payment gateway, Sri Lanka): processes your payment on its own page and sends us the result. PayHere is a separate controller for the card or wallet data you enter there.
- Resend (transactional e-mail, processing in the United States): receives the recipient address, name and content of the e-mails we send you.
- Sentry (error monitoring, United States or European Union): optional and not enabled at the date of this draft. If enabled, it would receive technical error reports with personal data removed by configuration.
- OpenFreeMap (map tiles): when you open a map, your browser fetches map tiles directly from the OpenFreeMap servers, which therefore see your network address and the requested tile. This is a third-party service your browser contacts, not a processor acting for us.

## 8. Payment processing

The advance is paid on the hosted payment page of PayHere. You enter your card or wallet details there, not on the platform. PayHere states that card credentials are processed on PCI DSS certified bank systems. The platform receives a signed notification with the result, the amount, the payment identifier and the method, verifies its signature and records the outcome.

Refunds are processed by the platform team through PayHere or by bank transfer. If a bank transfer is needed, we ask you by e-mail for the account to pay into and do not store those details on the platform.

## 9. Verification documents

Documents uploaded by providers are checked for file type, stored in a private storage bucket under a key generated by the platform, and are never linked publicly. They can be downloaded only by the provider who uploaded them and by platform team members reviewing them; every team download is recorded in the audit log.

A newer upload of the same document type supersedes the previous one; rejected and superseded files are deleted after the periods set out in the retention section.

## 10. Location data

Provider pickup locations are published as an approximate area (a grid of roughly 550 metres) or as the centre of the town until a booking is confirmed; the exact address and pin are shown only to the customer of a confirmed booking.

If you allow your browser to share your position to search nearby, the position is used only to run that search and is not stored. Search statistics record the place or district searched, never coordinates.

Map tiles are fetched by your browser from OpenFreeMap, which sees your network address; see the section on service providers. If the map cannot load, the listing results remain available as a list.

## 11. Cookies and browser storage

The platform sets one cookie, named vrp_refresh, or __Secure-vrp_refresh when served over a secure connection. It keeps you signed in, is marked HttpOnly and Secure, is sent only to the authentication endpoints and expires with your session (30 days for customers and providers, 8 hours for platform team accounts). Your short-lived access token is held in the memory of the page and is not stored.

We do not use analytics, advertising or tracking cookies, and we do not load third-party trackers.

## 12. Logs, security and fraud prevention

We record the network address and browser identification string of sign-ins and token requests, apply rate limits by network address, and keep an audit trail of actions by providers and the platform team. We use these records to protect accounts, detect abuse and forged payment notifications or documents, and investigate incidents.

Passwords are stored as Argon2id hashes. Connections use TLS. Databases and object storage are encrypted at rest by the hosting providers. Authenticator secrets of platform team accounts are encrypted with a key held outside the database. Access to production systems is limited to the platform team and recorded.

## 13. How long we keep data

Retention periods are set out in the platform retention policy (docs/security/DATA_RETENTION.md), which this notice follows. The periods below are proposals pending legal review. [LEGAL REVIEW REQUIRED]

- Account data: for the life of the account. When an account is deleted it is anonymised: e-mail, name, telephone, country and password are removed or replaced, and sessions and tokens are revoked.
- Booking, payment and audit records: kept after anonymisation, with personal fields removed, for a proposed period of 7 years for financial and legal record keeping. [LEGAL REVIEW REQUIRED]
- Driver details on a booking: the driver name is replaced when the account is anonymised; a scheduled purge of driver details after the booking is proposed and is not enabled until legal review confirms the period. [LEGAL REVIEW REQUIRED]
- Verification documents: kept while they are current; rejected documents are deleted 30 days after rejection and superseded documents 90 days after being replaced (proposed values held in platform settings). [LEGAL REVIEW REQUIRED]
- Sign-in sessions: 30 days after expiry or revocation. One-time e-mail tokens: 7 days after use or expiry.
- Request logs: 90 days (proposed). Anonymous search statistics: 400 days.
- E-mail content held by the e-mail provider: according to its own retention (30 days on the free plan of that provider).

## 14. Your rights

You can exercise the following rights from your account page or by writing to [PLACEHOLDER: PRIVACY_CONTACT_EMAIL the privacy contact address]. We will confirm receipt and respond in writing within one month, which may be extended by up to two further months for complex requests, in which case we tell you before the first month ends. Requests are free of charge. These response times follow the Personal Data Protection Act as amended by Act No. 22 of 2025 (section 4); the part of the Act containing these rights has not yet been brought into operation and the wording is under legal review. [LEGAL REVIEW REQUIRED]

We may need to verify your identity before acting on a request, for example by asking you to confirm from the e-mail address on the account.

- Access and export: download a copy of the personal data held on your account in a machine-readable file from your account page, or ask us for it.
- Correction: update your name, telephone number, country, language and currency on your account page; ask us to correct anything else.
- Deletion: request the deletion of your account from your account page or by writing to us. Deletion is carried out as anonymisation as described in the retention section. It cannot be completed while you have an open booking, an open dispute, an unresolved payment or a refund due; we tell you what is outstanding.
- Objection and withdrawal of consent: where processing rests on consent or on our legitimate interests, you may withdraw consent or object; we explain the consequences for your account. [LEGAL REVIEW REQUIRED]
- Complaints: you may complain to us at the address above and to the Data Protection Authority of Sri Lanka (https://www.dpa.gov.lk/). The Authority investigates complaints once the relevant parts of the Act are in operation. [LEGAL REVIEW REQUIRED]

## 15. Where your data is processed

The platform is operated from Sri Lanka, but the companies that host it are abroad. Application hosting and the database are in Singapore (Railway, and Neon or Supabase). Transactional e-mail is processed in the United States (Resend). Cloudflare operates a global network and does not guarantee an Asian storage location for object storage. Error monitoring, if enabled, would be in the United States or the European Union (Sentry).

The Personal Data Protection Act (section 26 as amended) permits cross-border processing where the controller remains compliant with the Act and adopts the instruments specified by the Data Protection Authority to bind the recipient, or where another ground in the Act applies. The list of instruments has been published only in draft (binding corporate rules, an agreement, a code of conduct, a certification scheme, an impact assessment or a board resolution). We maintain a cross-border transfer register and will put the required instrument in place with each provider before launch. [LEGAL REVIEW REQUIRED]

## 16. How we protect your data

We apply technical and organisational measures appropriate to the data we hold: encrypted connections, hashed passwords and tokens, encrypted authenticator secrets, private storage for documents with audited access, role-based access for the platform team with a second authentication factor, rate limiting, server-side verification of every payment notification, input validation, logging without secrets, and regular dependency and security review. No system is perfectly secure; if a breach affecting your data occurs we follow our breach response procedure and inform you and the Authority where required. [LEGAL REVIEW REQUIRED]

## 17. Children

The platform is for adults. You must be at least 18 years old to create an account. We do not knowingly collect data from children; if you believe a child has created an account, contact us and we will remove it.

## 18. Automated decisions and profiling

The platform makes no decisions about you by automated means that have legal or similarly significant effects. Booking requests are accepted or declined by providers; provider applications, listings, documents, disputes and refunds are decided by people on the platform team. Provider response and acceptance figures shown on listings are simple published formulas over recent bookings and are not used to rank or penalise anyone. Timers (request and payment deadlines, document expiry, reminders) run automatically according to the published rules.

## 19. Changes to this notice

This notice carries a version, which is recorded on your account when you accept it. We may update the notice; the new version is published on this page with a new effective date and account holders are told before it applies. [LEGAL REVIEW REQUIRED]

## 20. Contact

Privacy contact: [PLACEHOLDER: PRIVACY_CONTACT_EMAIL]. Support: [PLACEHOLDER: SUPPORT_EMAIL]. Postal address: [PLACEHOLDER: REGISTERED_ADDRESS]. Data protection officer: [PLACEHOLDER: DPO_CONTACT].
