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

**✅ B3. Arbitration — YES.** Binding individual arbitration with a
class-action waiver, drafted into the Terms.
*Attorney to specify:* the administering body and its consumer rules, and
whether to include a 30-day opt-out window (commonly used to strengthen
enforceability). Both are marked in the text.

**✅ B4. Small-claims carve-out — YES.** Drafted as an explicit exception,
and stated as the cheaper route for most neighbor-scale disputes.

## C. Liability — the part that actually matters

**✅ C1. Posture confirmed.** Users lend and borrow **entirely at their own
risk**. The lender is responsible for the condition of the tool handed over;
the borrower for using it safely and returning it. Platow Inc. is **not a
party** to any loan and disclaims liability for injury, damage, loss or theft.

**❓ C2. Enforceability — the one question for you.** *Nothing for Platow to
decide here; this is a question TO the attorney.* We have written a broad
liability disclaimer. Courts do not always honour those: several states
restrict or void waivers of liability for personal injury, gross negligence
cannot be waived anywhere, and California Civil Code §1668 voids contracts
exempting fraud, willful injury, or violation of law.

> **Please advise:** given those limits, is this the strongest wording actually
> available to us, and is there anywhere it should say something different? A
> disclaimer that reads as absolute but fails in court is worse than one that
> is narrower and holds.

**✅ C3. Liability cap** — **$100**. No fees are charged, so the "or fees paid
in the last 12 months" alternative never applies.

**✅ C4. Insurance — none carried.** Confirmed. The Terms accordingly promise
no coverage of any kind and state that Platow Inc. is not an insurer.

**✅ C5. Supervision — deliberately not mentioned.** Confirmed: the Terms say
nothing about supervision or borrower competence, so nothing in the contract
implies a duty of care that the product does not create. This matches the
earlier product decision to remove competency certification.

## D. Money, refunds and cancellation

> **Reality check:** Toolber processes **no payments**. Rental prices are
> displayed; money changes hands directly between neighbors, outside the app.
> Toolber cannot refund money it never held, and the draft says so plainly.

**✅ D1. No payments at launch — confirmed.** Money changes hands directly
between neighbors. Payments are wanted later; when they arrive, this section
and the refund language both have to be rewritten, because Toolber would then
be holding money it currently never touches.

**✅ D2. Defective tool — agreed as drafted.** Stop using it, report it in the
app (which marks the tool unavailable), tell the owner, and the owner returns
any fee paid. Stated as a neighborly norm, explicitly not something Toolber
enforces.

**✅ D3. Disputes between users.** Toolber does not mediate or arbitrate, and
says so plainly.

**✅ D4. Cancellation.** No reservation mechanism exists. A borrower can
withdraw while pending, an owner can decline, either side can mark a tool
returned. The Terms describe exactly that and nothing more.

**✅ D5. Reservations — not now.** Wanted later. Deliberately absent from the
Terms so the document does not describe a feature that does not exist.

**✅ D6. Late return — daily reminders, then it's the owner's call.** Reminders
now go to both sides **daily** while a tool is overdue (changed from every
three days). The Terms state that Toolber does not recover tools, chase
borrowers, or reimburse owners; the owner may report the borrower in-app, and
if they believe the tool was stolen, that is a matter for local law
enforcement.

## E. Eligibility and conduct

**✅ E1. Minimum age** — 18, enforced by a self-declared checkbox at signup.

**✅ E2. Geographic scope** — **United States only** at launch, now stated in
the Terms. This is also why no GDPR language is included.

**✅ E3. Prohibited items** — firearms, ammunition, explosives, and anything
requiring a licence to operate.

**✅ E4. Account termination** — accounts may be suspended or removed at
Platow's discretion, with in-app reporting as the intake.

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

**✅ F1. Data retention — confirmed.** Deletion within 30 days of request,
except records needed for an open dispute.

**✅ F2. Deletion mechanism** — built. Settings → Delete account, two-step,
guarded against deleting mid-loan or orphaning a group. It anonymises rather
than hard-deletes, because borrow history and messages are the *counterparty's*
records too.

**⚠️ F2b. Deleted email addresses — decision needed, and it is ours not the
attorney's.** Today, deleting an account leaves the sign-in record in place.
The person cannot get back in, but the email address is held and **cannot be
used to sign up again**. That blocks someone who leaves and later wants to
return — which is a normal thing for a neighbor to do.

Two ways to fix it, both real work:

1. **Release the address on deletion.** Change the stored sign-in address to a
   dead placeholder so the original is free to register again. The person can
   re-join with the same email as a genuinely new account. Straightforward, and
   it also makes the deletion more complete.
2. **Fully erase the sign-in record.** Cleaner in principle, but it requires
   unpicking seven database constraints that deliberately preserve the other
   neighbor's borrow history and messages.

Recommendation: option 1. It solves the re-join problem and removes more
personal data, without touching the records that belong to someone else.

*Still worth asking the attorney:* does "anonymised and locked out" satisfy a
deletion request in the relevant jurisdictions, or does the sign-in record have
to go entirely?

**✅ F3. State privacy laws — understood.** California (CCPA/CPRA), Virginia,
Colorado, Connecticut, Utah and others each set their own thresholds. At
neighborhood scale Toolber is likely under all of them, but confirmation is the
attorney's to give.

**✅ F4. Children** — not for under-18s; no knowing collection.

**✅ F5. Sub-processors — confirmed.** Supabase (database, auth, storage),
Cloudflare (hosting, bot protection), Mapbox (maps), Resend (email). Adding one
later means updating the policy.

**✅ F6. Analytics** — none third-party. Confirmed.

**✅ F7. Sale of data** — never. Confirmed.

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
