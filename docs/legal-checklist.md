# Legal checklist — Toolber / Platow Inc.

**These are drafts, not legal advice.** Nothing here has been reviewed by a
lawyer. The purpose of this document is to make the attorney conversation
short and concrete.

The full drafts live at **https://toolber.org/terms** and
**https://toolber.org/privacy** — both carry an "unreviewed draft" banner
until they're signed off.

Legend: **✅ answered** · **⚠️ drafted, needs a legal opinion** · **☐ open**

---

## A. Company and contact — settled

| | |
|---|---|
| **A1** Legal entity | ✅ **Platow Inc.** |
| **A2** State of incorporation | ✅ **Delaware** — inferred from the Dover registered address. Please confirm. |
| **A3** Registered address | ✅ **8 The Green, Ste B, Dover, DE 19901** |
| **A4** Legal notices email | ✅ **legal@toolber.org** |
| **A5** Privacy requests email | ✅ **legal@toolber.org** — must be monitored; several state laws impose response deadlines. |
| **A6** Toolber ↔ Platow | ✅ Drafted as **one contracting party**: Toolber is a product operated by Platow Inc. An earlier draft said "neither we nor [parent]", implying two entities; corrected. Confirm no separate subsidiary exists. |

## B. Governing law and disputes

**⚠️ B1. Governing law** — drafted as **Delaware**, matching incorporation.
*For the attorney:* if principal operations sit in another state, that state's
consumer protection law may apply regardless of what the contract says.

**⚠️ B2. Venue** — drafted as **Delaware state or federal courts**.
*For the attorney:* is this realistic? Requiring a neighbor in another state to
sue in Delaware may be unenforceable, and reads as hostile for a neighborhood
app.

**☐ B3. Arbitration clause — yes or no?** The one genuinely open drafting
decision. Currently marked `[ARBITRATION CLAUSE — TO BE DECIDED]` in the text.

- *With* arbitration + class-action waiver: caps the cost of a mass claim —
  the scenario that would end a small company.
- *Without*: less hostile to read, and avoids arbitration-fee exposure, where a
  wave of individual arbitrations can cost more than a single lawsuit.

No recommendation from me — this is squarely a legal judgment.

**☐ B4. Small-claims carve-out?** Common even alongside arbitration, and reads
as fair to neighbors.

## C. Liability — the part that actually matters

**☐ C1. Confirm the posture.** The draft says: users lend and borrow **entirely
at their own risk**; the lender is responsible for the condition of the tool
they hand over; the borrower is responsible for using it safely and returning
it; Platow Inc. is **not a party** to any loan and disclaims liability for
injury, damage, loss or theft.

**☐ C2. Enforceability limits — please address directly.** Flagging, not
advising: waivers of liability for personal injury are restricted or void in
several states, gross negligence generally cannot be waived anywhere, and
California Civil Code §1668 voids contracts exempting fraud, willful injury, or
violation of law. **A disclaimer that reads as absolute may not survive contact
with a real injury claim.** This is the single most important question on this
page.

**✅ C3. Liability cap** — **$100**, as drafted. No fees are charged, so the
"or fees paid in the last 12 months" alternative never bites.

**☐ C4. Insurance.** Is any carried? Should it be, before neighbors rather than
after?

**☐ C5. Supervision and duty of care.** The app has a `supervision_required`
flag per borrower per tool. Should the terms mention it at all — or does
mentioning supervision imply a duty of care that doesn't otherwise exist? The
product deliberately removed borrower competency certification for exactly this
reason; worth not undoing that by accident in the contract.

## D. Money, refunds and cancellation

> **Reality check:** Toolber processes **no payments**. Rental prices are
> displayed; money changes hands directly between neighbors, outside the app.
> Toolber cannot refund money it never held, and the draft says so plainly.

**☐ D1.** Confirm that's still true at launch.

**☐ D2. Defective tool.** Draft: the borrower stops using it immediately,
reports it in the app (which marks the tool unavailable), tells the owner, and
the owner returns any fee paid. Stated as a neighborly norm, explicitly *not*
something Toolber enforces.

**☐ D3. Disputes between users.** Currently: Toolber does not mediate or
arbitrate, and says so. Recommend staying out of it entirely at this scale.

**☐ D4. Cancellation.** What the app actually does today: a borrower can
withdraw while a request is pending, an owner can decline, either side can mark
a tool returned. **There is no reservation window or time-slot booking**, so
there is nothing to cancel after approval except ending the loan early.

**☐ D5. Do you want reservations?** "Reserved for Saturday morning" with a
cancellation deadline is a product feature that would need building first.

**☐ D6. Late return.** The app sends overdue reminders to both sides every 3
days. Should lateness carry any stated consequence, or stay social?

## E. Eligibility and conduct

**☐ E1. Minimum age** — draft says 18; signup enforces a self-declared 18+
checkbox.
**☐ E2. Geographic scope** — US only at launch? Determines whether GDPR
language is needed at all.
**☐ E3. Prohibited items** — draft bans firearms, ammunition, explosives, and
anything requiring a licence to operate.
**☐ E4. Account termination** — draft: accounts may be suspended or removed at
Platow's discretion, with the in-app report feature as the intake.

---

## F. Privacy — what the app actually collects

Compiled from the database schema rather than a template, so every line is
checkable against the code.

| Data | Purpose | Confirm |
|---|---|---|
| Email address, hashed password | Sign-in and notifications | ☐ |
| Display name | Shown to other users | ☐ |
| Phone (optional) | Shared with an approved counterparty **only if the user opts in** | ☐ |
| Approximate location | Public map pin, deliberately fuzzed | ☐ |
| **Exact home coordinates** | Never shown to anyone; used once to compute the fuzzed pin | ☐ |
| **Exact pickup address** | Shared only with an approved borrower, only for 30 days, and only if the owner has opted in per tool | ☐ |
| Tool listings and photos | Public | ☐ |
| Messages, borrow history | Between the two participants | ☐ |
| Usage events | Internal analytics only — no third-party vendor | ☐ |
| Reports about users | Sent to platform admins | ☐ |

**☐ F1. Data retention.** Draft says deletion within 30 days of request, except
records needed for an open dispute.

**✅ F2. Deletion mechanism** — built. Settings → Delete account, two-step,
guarded against deleting mid-loan or orphaning a group. It anonymises rather
than hard-deletes, because borrow history and messages are the *counterparty's*
records too.

**⚠️ F2b. Residual limit — please advise.** The sign-in record in the
authentication system is not erased, so the email address survives there and
cannot be reused. The user cannot get back in. **Does "anonymised and locked
out" satisfy a deletion request in the relevant jurisdictions?**

**☐ F3. State privacy laws.** California (CCPA/CPRA), Virginia, Colorado,
Connecticut, Utah and others have their own thresholds. At neighborhood scale
Toolber is likely under all of them — but "likely" is the attorney's word to
say, not mine.

**☐ F4. Children.** Draft: not for under-18s, no knowing collection.

**☐ F5. Sub-processors.** Currently **Supabase** (database, auth, storage),
**Cloudflare** (hosting, bot protection), **Mapbox** (maps), **Resend**
(email). Adding one later means updating the policy.

**☐ F6. Analytics.** Toolber runs no third-party analytics. A genuinely good
line to be able to write — confirm it stays true.

**☐ F7. Sale of data.** Draft says never.

---

## G. Remaining engineering work

- [ ] Replace `[ARBITRATION CLAUSE — TO BE DECIDED]` once B3 is answered — the
      last placeholder left in the text
- [ ] Bump `TERMS_VERSION` from `draft-2026-08-29` to the signed-off version,
      which is recorded against every user who accepts
- [ ] Remove the "unreviewed draft" banner from both pages
- [ ] Decide whether acceptance should also be recorded at **signup** rather
      than only at onboarding — today an account exists before anything is
      accepted
