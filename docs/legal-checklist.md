# Legal checklist — fill before the attorney call

**These are drafts, not legal advice.** Nothing here has been reviewed by a
lawyer. The point of this file is to make the attorney conversation short and
concrete: every `[ ]` below is a decision only you can make, and every one of
them appears as a bracketed blank in the draft pages at `/terms` and
`/privacy`. Fill these in, and the drafts become specific enough to redline.

Where I have a recommendation I've said so and why. Where a choice is
genuinely legal rather than product, I've said that instead and left it alone.

---

## A. Company and contact

- [ ] **A1. Exact legal entity name.** The signup page will say users are
      contracting with this. Currently drafted as *Platow Inc.* — confirm the
      exact registered name, including suffix (Inc. / LLC / Corp.).
- [ ] **A2. State of incorporation.** The folder name suggests Delaware.
      Confirm.
- [ ] **A3. Registered business address.** Required on most consumer-facing
      terms, and by CAN-SPAM on marketing email.
- [ ] **A4. Contact email for legal notices.** Recommend a dedicated address
      (`legal@toolber.org`) rather than a personal inbox.
- [ ] **A5. Contact email for privacy requests.** Can be the same address.
      Must be monitored — several state laws impose response deadlines.
- [ ] **A6. Relationship between Toolber and Platow Inc.** Is Toolber a
      product name, a DBA, or a subsidiary? This determines who the user is
      actually contracting with, and it needs to be one answer, stated once.

## B. Governing law and disputes

- [ ] **B1. Governing law.** Usually the state of incorporation or principal
      operations. Attorney's call.
- [ ] **B2. Venue.** Which county/state courts hear a dispute.
- [ ] **B3. Arbitration clause — yes or no?** A real fork worth understanding
      before deciding:
      - *With* arbitration + class-action waiver: caps the cost of a mass
        claim, which is the scenario that would end a small company.
      - *Without*: less hostile to read, avoids arbitration-fee exposure
        (a wave of individual arbitrations can cost more than a lawsuit),
        and some states scrutinise consumer arbitration heavily.
      I have no recommendation here — this is squarely a legal judgment.
- [ ] **B4. Small-claims carve-out?** Common even with arbitration, and reads
      as fair to neighbors.

## C. Liability — the part that actually matters

- [ ] **C1. Confirm the posture.** Draft currently says: users lend and borrow
      **entirely at their own risk**; the lender is responsible for the tool
      they hand over; the borrower is responsible for using it safely and
      returning it; Toolber/Platow is **not a party** to any loan and
      disclaims liability for injury, damage, loss or theft.
- [ ] **C2. Ask the attorney specifically about enforceability limits.** I am
      flagging, not advising: waivers of liability for personal injury are
      restricted or void in several states, gross negligence generally cannot
      be waived, and California Civil Code §1668 voids contracts exempting
      fraud, willful injury, or violation of law. A disclaimer that reads as
      absolute may not survive contact with a real injury claim.
- [ ] **C3. Liability cap amount.** Draft says the greater of $100 or fees
      paid in the last 12 months — which, with no payments, is $100. Confirm
      or change.
- [ ] **C4. Insurance.** Do you carry any? Does the answer change what the
      terms should promise? Worth asking the attorney whether a general
      liability policy is warranted before neighbors, not after.
- [ ] **C5. Stationary tools and supervision.** The app has a
      `supervision_required` flag per borrower per tool. Should the terms say
      anything about it, or does mentioning supervision imply a duty of care
      that currently doesn't exist? **The feature checklist already records a
      deliberate decision to remove competency certification for exactly this
      reason** — worth not undoing it by accident in the terms.

## D. Money, refunds and cancellation

> **Reality check:** Toolber processes no payments today. Rental prices are
> displayed; money changes hands directly between neighbors, outside the app.
> Toolber cannot refund money it never held.

- [ ] **D1. Confirm that's still true at launch.** If yes, the refund section
      describes expectations between users and states plainly that Toolber is
      not a payment processor and issues no refunds.
- [ ] **D2. Defective tool — what *should* happen?** Draft says: the borrower
      stops using it immediately, reports it in the app (which flips the tool
      to unavailable), and the lender refunds any rental fee already paid.
      Confirm that's the norm you want to set.
- [ ] **D3. Who decides a dispute?** Currently: nobody. Toolber has no
      arbitration or mediation role, and the draft says so. Alternative is a
      lightweight "we may, but are not obliged to, help" clause. Recommend
      staying out of it entirely at this scale.
- [ ] **D4. Cancellation — confirm what the product actually does.** Today:
      a borrower can withdraw a request while it is still pending; an owner
      can deny a request; either side can mark a tool returned. **There is no
      reservation window or time-slot booking**, so there is nothing to
      cancel *after* approval except ending the loan early.
- [ ] **D5. Do you want reservations?** If you want "reserved for Saturday
      morning" with a cancellation deadline, that is a product feature to
      build first. Writing the policy now would describe something that
      doesn't exist. Say the word and I'll scope it.
- [ ] **D6. No-show / late return.** Anything beyond "return it by the agreed
      date"? The app now sends overdue reminders to both sides at 3-day
      intervals. Should late return carry any stated consequence, or stay
      social?

## E. Eligibility and conduct

- [ ] **E1. Minimum age.** Draft says 18. Signup already enforces a
      self-declared 18+ checkbox.
- [ ] **E2. Geographic scope.** US only at launch? This affects whether GDPR
      language is needed at all.
- [ ] **E3. Prohibited items.** Draft bans firearms, ammunition, explosives,
      and anything requiring a licence to operate. Add or remove.
- [ ] **E4. Account termination.** Draft: you may suspend or remove an account
      at your discretion, with the report-a-user feature as the intake. Confirm.

---

## F. Privacy — what the app actually collects

Filled in from the schema rather than from a template, so this list is
accurate. Confirm each, and flag anything you'd rather not collect.

| Data | Where | Why | Confirm |
|---|---|---|---|
| Email address | Supabase Auth | Sign-in, notifications | [ ] |
| Password (hashed) | Supabase Auth | Sign-in | [ ] |
| Display name | `profiles` | Shown to other users | [ ] |
| Phone (optional) | `profiles` | Shared only with an approved borrow counterparty | [ ] |
| Approximate location | `profiles.approx_lat/lng` | Public map pin | [ ] |
| **Exact home coordinates** | `profiles.home_lat/lng` | Never shown to anyone; used once to compute the fuzzed pin | [ ] |
| **Exact pickup address** | `tools.pickup_location` | Revealed only to an approved borrower, and only for 30 days | [ ] |
| Tool listings and photos | `tools`, Storage | Public | [ ] |
| Messages | `conversation_messages` | Between the two participants | [ ] |
| Borrow history | `borrow_requests` | Both parties | [ ] |
| Usage events | `events` | Internal analytics only, no third-party vendor | [ ] |
| Reports about users | `user_reports` | Sent to platform admins | [ ] |

- [ ] **F1. Data retention.** How long do you keep an account after deletion?
      Recommend: delete on request, purge within 30 days, except records you
      must keep for a dispute.
- [x] ~~**F2. Deletion mechanism.**~~ Built (0032). Settings → Delete
      account, two-step, guarded server-side against deleting mid-loan or
      orphaning a group you administer. It scrubs rather than hard-deletes,
      because seven foreign keys into `profiles` have no ON DELETE action and
      the rows behind them are the counterparty's records too.
- [ ] **F2b. Confirm the residual limit is acceptable.** The row in
      `auth.users` is not removed, so the email address survives in the auth
      schema and cannot be reused. Purging it needs the admin API plus rework
      of those seven constraints. Worth asking the attorney whether "disabled
      and anonymised" satisfies a deletion request in your jurisdiction.
- [ ] **F3. State privacy laws.** California residents have specific rights
      (CCPA/CPRA) if thresholds are met; Virginia, Colorado, Connecticut,
      Utah and others have their own. At neighborhood scale you are probably
      under every threshold, but "probably" is the attorney's word to say,
      not mine.
- [ ] **F4. Children.** Draft says the service is not for under-18s and you
      don't knowingly collect their data. Confirm.
- [ ] **F5. Sub-processors to disclose.** Currently: **Supabase** (database,
      auth, storage), **Cloudflare** (hosting, bot protection), **Mapbox**
      (maps), **Resend** (email). Confirm this list is complete — adding one
      later means updating the policy.
- [ ] **F6. Analytics.** Toolber runs no third-party analytics. That's a
      genuinely good line to be able to write; confirm it stays true.
- [ ] **F7. Do you sell or share data?** Draft says never. Confirm.

---

## G. Wiring (mine, once you've answered)

- [x] Draft `/terms` and `/privacy` pages
- [x] Link both from the signup checkbox
- [ ] Replace every `[BRACKETED]` blank with your answers
- [ ] Bump `tos_version` in `Onboarding.jsx` from `v0-placeholder` to the
      dated version the attorney signs off on
- [ ] Decide whether acceptance should also be recorded at **signup** rather
      than only at onboarding — today a user technically creates an account
      before accepting anything
