# Runbook: personal data breach response

**Status:** v0.1 (2026-10-17), Phase 10. Audience: the founder (controller representative), the on-call engineer and legal counsel.
**Legal position (verified 2026-10-17 on dpa.gov.lk):** the Personal Data Protection Act No. 9 of 2022, as amended by Act No. 22 of 2025, requires in section 23(1) that "in the event of a personal data breach, a controller shall notify the Authority, regarding such personal data breach in such form, manner and within such period of time as may be determined by rules made under this Act". Part III, which contains section 23, comes into operation on **1 January 2027** (Gazette 2498/16 of 22 July 2026). **No final rules exist.** The only text on timing is the **draft** Personal Data (Personal Data Breach Notification) Rules (public consultation, 01-10-2024): notify the Authority unless the breach is unlikely to result in a risk or is likely to result in a low risk (draft rule 3), "to the extent feasible, within seventy two hours" of becoming aware (draft rule 5(1)), late notifications with reasons (draft rule 5(2)), notify data subjects where the breach is likely to result in a high risk (draft rule 4), at the same time as the Authority (draft rule 9), and keep written records of all breaches (draft rule 19). **The 72-hour timeline and the risk thresholds are draft only and are not confirmed as binding: LEGAL REVIEW REQUIRED before relying on them.** Until counsel says otherwise this runbook works to the 72-hour target as an internal deadline.
**Related:** [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) (the technical incident runs in parallel), [../legal/PROCESSOR_REGISTER.md](../legal/PROCESSOR_REGISTER.md) (processor contacts), [../security/DATA_RETENTION.md](../security/DATA_RETENTION.md) (what data exists where), docs/SECURITY_AND_PRIVACY.md §7.

## 1. What counts as a personal data breach

Any event where personal data held by the platform or its processors was, or may have been, accessed, disclosed, altered, lost or destroyed without authorisation. Examples specific to this platform: a verification document reachable without authentication; an admin account used by someone else; an e-mail with booking details sent to the wrong recipient; a database backup copied to an unapproved location; a vendor incident reported by Railway, Neon or Supabase, Cloudflare, Resend or PayHere; a lost laptop holding a production dump; a bug that showed one user another user's booking, contact details or export.

A near miss (vulnerability found, no evidence of access) is recorded in the breach register (section 9) with the decision "no breach" and the reasoning.

## 2. Roles

| Role           | Who                                                                  | Responsibility                                                                                          |
| -------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Breach lead    | Founder, or the privacy lead when named ([PLACEHOLDER: DPO_CONTACT]) | Owns the decision log, the risk assessment and every external communication                             |
| Technical lead | On-call engineer                                                     | Identification, containment, evidence; feeds facts into the decision log                                |
| Legal counsel  | [PLACEHOLDER: LEGAL_COUNSEL_CONTACT]                                 | Decides whether and how to notify the Authority and data subjects (LEGAL REVIEW REQUIRED at every step) |
| Communications | Founder                                                              | User e-mails, status note, press if any; counsel reviews wording                                        |

## 3. Step 1: identify the data (first hours)

Answer and record in the decision log:

1. **Which systems**: database (which tables), object storage (`vrp-private` documents or photo originals; `vrp-public` is public by design), e-mail provider, logs, backups, a laptop, a vendor.
2. **Which data categories** (use DATA_RETENTION.md §3 as the checklist): account data; session data (IP, user agent); provider contact and address; verification documents (identity, business registration, CR, revenue licence, insurance, emission); vehicle registration numbers; booking driver details; booking notes; payment metadata (order and payment ids, amounts, method; the platform holds no card data); reviews and disputes; privacy requests; admin MFA envelopes (encrypted; the key lives outside the database).
3. **How many data subjects and who**: by role (customers, providers, tourists abroad, staff) and, where possible, the exact list of user ids.
4. **Time window**: first possible unauthorised access to containment.
5. **Cause**: external attack, insider, vendor, bug, human error.
6. **Was the data protected**: hashed (passwords, tokens, recovery codes), encrypted (MFA secrets), masked, or in clear (most profile and booking data, registration numbers, documents).

## 4. Step 2: contain

Use the containment table in INCIDENT_RESPONSE.md §4. Typical actions, in order:

1. Cut the access path: suspend the account (`POST /admin/users/{id}/suspend`), reset admin MFA (`pnpm admin:mfa-reset`), remove public access on the bucket, block the route or source at Cloudflare, roll back the deployment, scale the API to zero if nothing else works.
2. Rotate every secret that may have been exposed (SECRET_ROTATION.md): `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`, `DATABASE_URL` credentials, `JWT_PRIVATE_KEY`, `APP_DATA_ENCRYPTION_KEY` (with `_PREVIOUS` overlap), `PAYHERE_*`, `SMTP_PASS`, `BOOKING_QUOTE_SECRET`.
3. Force sign-out of affected users: suspension revokes sessions; for a wide incident engineering sets `users.sessions_revoked_at` through a reviewed migration or script, never by ad-hoc editing (decision recorded in the log).
4. Preserve, do not destroy: keep the affected database or bucket readable for forensics; take a snapshot before any clean-up.

## 5. Step 3: logs and evidence

- Export API and worker logs for the window by `x-request-id` and route; note the client IPs involved (`X-Real-IP` as recorded behind the configured proxy hops).
- From the database (read-only, by engineering): `audit_events` for the actors and targets (`document.viewed` rows identify which documents an admin streamed; `booking.contact_revealed` identifies contact reveals), `refresh_tokens` rows of the affected accounts (IP, user agent, times), `payment_events` where payments are involved.
- From vendors: Cloudflare security events and R2 access logs if available, Railway deployment and variable change history, Resend delivery logs, PayHere merchant portal.
- Hash files rather than copying them; keep evidence in the operator's encrypted store; never in the repository, never in chat tools.

## 6. Step 4: affected users

Produce the list of user ids and roles. Decide for each group whether they must be told (section 8). Prepare the facts a user needs: what data, when, what we did, what they should do (change password if a password hash leaked; watch for phishing that quotes booking details; replace an identity document if a document leaked), and how to reach us. Do not send anything before the breach lead and counsel approve the wording.

## 7. Step 5: processor contacts

If a processor is involved or must help with evidence, contact it through the channel recorded in PROCESSOR_REGISTER.md (all EXTERNAL GATE — NOT EXECUTED until accounts exist). Ask for: the vendor's incident reference, the time window, the data or objects accessed, the logs they can provide, and whether other customers were affected. Record each contact in the decision log. If the vendor is the source of the breach, their contractual notification duty to us (vendor DPA) applies; our duty to the Authority and to data subjects is ours (LEGAL REVIEW REQUIRED).

## 8. Step 6: risk assessment and the notification decision

Assess and record, with counsel:

| Factor                       | Questions                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nature of the data           | Identity documents and registration numbers weigh heaviest; hashed or encrypted data without the key is low risk; public photo variants are not a breach |
| Volume and subjects          | How many; tourists abroad (cross-border consequences); staff accounts                                                                                    |
| Likelihood of harm           | Identity fraud, phishing with booking details, physical safety (home addresses of sole-trader providers, pickup addresses with dates), financial loss    |
| Mitigations already in place | Containment done, secrets rotated, sessions revoked, data was encrypted or hashed                                                                        |
| Who had access               | A single known person (an employee, a provider who saw another's data) versus the open internet                                                          |

Decisions to record (each marked LEGAL REVIEW REQUIRED until final rules exist):

1. **Notify the Data Protection Authority?** Draft rule 3 says yes unless the breach is unlikely to result in a risk or is likely to result in a low risk. Target: within 72 hours of becoming aware (draft rule 5(1)); if later, record the reasons (draft rule 5(2)). Before 1 January 2027 section 23 is not in operation; counsel decides whether to notify voluntarily. Authority contact: https://www.dpa.gov.lk/ (the only official site; `dataprotection.gov.lk` does not resolve). The form and manner are not yet published.
2. **Notify data subjects?** Draft rule 4: where the breach is likely to result in a high risk; draft rule 9: at the same time as the Authority. Independently of the rules, tell users whenever telling them helps them protect themselves.
3. **Notify PayHere?** When payment flows or merchant credentials are involved (merchant agreement obligations; LEGAL REVIEW REQUIRED).
4. **Notify other parties?** Insurers, banks, police (for theft or extortion), the platform's own processors.

## 9. Step 7: communications workflow

1. Breach lead drafts; counsel reviews; founder approves. One voice.
2. Channels: e-mail from the support address to affected users (plain text, no links that look like phishing beyond the known domain, no personal data beyond what the recipient already knows); a status note on the web app if the incident was visible; the Authority through whatever channel it publishes.
3. Content of a user notice: what happened, when, which of their data, what we did, what they should do, how to contact us, that we have informed or will inform the Authority if that is the decision.
4. Record every message sent (recipient group, time, text) in the decision log. Keep the register entry (section 10) even when the decision is "no notification".
5. Internal: brief the operator team on what to say to users who call; nothing beyond the approved text.

## 10. Breach register and decision log

Draft rule 19 expects written records of all breaches regardless of notification. Keep the register in the operator's protected notes (not in this repository) with one entry per event using this template:

```
Breach register entry: <id>            Opened (UTC / Colombo): <time>        Breach lead: <name>
Aware since: <time we became aware>    72 h target: <time>                   Notified Authority: <time or "no, because ...">
Systems: <database tables / buckets / vendor / device>
Data categories: <from DATA_RETENTION.md §3>
Data subjects: <count by role; list reference>
Window: <first access> to <containment>
Cause: <>
Protection in place: <hashed / encrypted / clear>
Containment actions: <routes, CLI, rotations, times>
Evidence: <where kept; request ids; vendor references; NO secrets or personal data>
Processor contacts: <vendor, time, reference>
Risk assessment: <factors and conclusion>
Decisions (LEGAL REVIEW REQUIRED):
  Authority notification: <yes/no, time, reasons>
  Data subject notification: <yes/no, groups, time>
  Other notifications: <PayHere / police / insurer>
Communications sent: <group, time, text reference>
Follow-ups: <owner, due>
Closed: <time>   Reviewed by counsel: <name, date>
```

## 11. After the incident

- Post-incident review per INCIDENT_RESPONSE.md §9 with the breach register entry attached.
- Update docs/SECURITY_AND_PRIVACY.md if a control changed; add a decision record to docs/TECH_DECISIONS.md for architectural changes.
- Review the retention inventory: a breach often shows data that need not have existed (DATA_RETENTION.md §6).
- When the Authority publishes final breach rules, replace the draft references in this runbook and in docs/SECURITY_AND_PRIVACY.md §7, and remove the LEGAL REVIEW REQUIRED markers that the final text resolves.
