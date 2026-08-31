import LegalPage, { H, P, UL } from "../components/LegalPage";

// DRAFT — not reviewed by an attorney. Every [BRACKETED] value is a decision
// recorded in docs/legal-checklist.md. Keep this page and that checklist in
// step: this page is the canonical text, the checklist is what's unanswered.
//
// Written to be read. Short sentences, plain words, no defined-term glossary.
// The liability sections still have to carry real weight, so those are the
// one place the language tightens up.
export const TERMS_VERSION = "draft-2026-08-29";

export default function Terms() {
  return (
    <LegalPage title="Terms of Service" version={TERMS_VERSION}>
      <P>
        Toolber is a place for neighbors to lend and borrow tools. These terms
        explain what you can expect from us, and what we expect from you.
        They're written to be read, not to be skipped.
      </P>
      <P>
        Toolber is operated by <b>Platow Inc.</b> ("we", "us"). By
        creating an account you agree to these terms.
      </P>

      <H>The short version</H>
      <UL
        items={[
          "We connect neighbors. We don't own, inspect, store, or handle any tool listed here.",
          "Every loan is between two people. We are not a party to it.",
          "Tools can hurt you. You use them at your own risk, and you're responsible for using them safely.",
          "If you lend a tool, you're responsible for handing over something safe to use.",
          "We don't handle money. Payments happen directly between neighbors.",
        ]}
      />
      <P>
        The rest of this page says the same things in more detail, because the
        detail matters if something goes wrong.
      </P>

      <H>Who can use Toolber</H>
      <P>
        You must be at least 18 years old, and Toolber is currently available{" "}
        <b>in the United States only</b>. You need a valid email address and
        an accurate display name — other neighbors are deciding whether to
        trust you with their property, and they deserve to know who they're
        dealing with.
      </P>
      <P>
        You're responsible for what happens under your account. If you think
        someone else has access to it, tell us at <b>legal@toolber.org</b>.
      </P>

      <H>What Toolber is, and what it isn't</H>
      <P>
        Toolber is a listing and messaging service. When you borrow a tool,
        your agreement is <b>with the neighbor who owns it</b> — not with us.
        We don't inspect tools, verify that they're safe, confirm that anyone
        knows how to use them, or check that anyone is who they say they are.
      </P>
      <P>
        We're not a rental company, a retailer, a repair service, a payment
        processor, or an insurer. We don't take custody of any tool at any
        point.
      </P>

      <H>If you lend a tool</H>
      <UL
        items={[
          "Only list tools you actually own and have the right to lend.",
          "Describe the tool honestly, including its condition and anything unusual about it.",
          "Don't lend a tool you know to be unsafe, damaged, or missing a guard or safety feature.",
          "Include whatever safety equipment normally comes with it.",
          "You decide who borrows your tool. You can decline any request for any reason that isn't unlawful discrimination.",
        ]}
      />
      <P>
        You are responsible for the condition of the tool you hand over. If
        you know it's faulty and lend it anyway, that's on you.
      </P>

      <H>If you borrow a tool</H>
      <UL
        items={[
          "Only use a tool you're competent to use. If you're unsure, don't — ask, watch a tutorial, or hire someone.",
          "Inspect it before you use it. If it looks wrong, stop and tell the owner.",
          "Use appropriate safety equipment. Follow the manufacturer's instructions.",
          "Return it on time, in the condition you got it, and tell the owner about any damage — including damage you caused.",
          "If you damage or lose a tool, you're responsible for repairing or replacing it.",
        ]}
      />

      <H>Risk — please read this part</H>
      <P>
        <b>
          Tools are dangerous. Power tools, ladders, and cutting equipment
          cause serious injuries every year, including to experienced people.
        </b>
      </P>
      <P>
        You use tools found through Toolber <b>entirely at your own risk</b>.
        That risk is yours whether you're borrowing or lending, and it doesn't
        transfer to us because the introduction happened here.
      </P>
      <P>
        Platow Inc., and anyone working for it, is not liable for injury,
        death, property damage, theft, or loss arising from any tool listed,
        borrowed, lent, or used through Toolber, or from any interaction
        between users — whether that happens online, at a pickup, or anywhere
        else.
      </P>
      <P>
        Nothing here limits liability that can't be limited by law. Some
        states don't allow the exclusion of certain damages, so parts of this
        section may not apply to you.
      </P>

      <H>Money between neighbors</H>
      <P>
        Toolber does not process payments. Some tools are listed free; others
        show a rental price the owner has set. Any money changes hands{" "}
        <b>directly between the two of you</b>, outside this app.
      </P>
      <P>
        This has a consequence worth being clear about: <b>we cannot issue
        refunds</b>, because we never received the money. If a payment goes
        wrong, it's between you and the other neighbor.
      </P>
      <P>
        Some listings are marked "open to sell". That's an invitation to ask,
        not an offer. Any sale is entirely between the two of you, and we're
        not involved in it.
      </P>

      <H>If a tool turns out to be defective</H>
      <P>Our expectation of everyone here:</P>
      <UL
        items={[
          "Stop using it immediately. Don't try to finish the job.",
          "Report it in the app. That marks the tool unavailable so nobody else borrows it in the same state.",
          "Tell the owner directly.",
          "If you paid a rental fee and the tool couldn't do the job, the owner should return the fee.",
        ]}
      />
      <P>
        That last point is a norm we expect neighbors to honor, not something
        we can enforce — again, we never held the money.
      </P>

      <H>Requests, approvals and cancellation</H>
      <P>
        Borrowing works in one direction: you ask, the owner decides. Nothing
        is reserved or committed until the owner approves.
      </P>
      <UL
        items={[
          "You can withdraw a request any time before it's approved.",
          "An owner can decline any request, with or without a reason.",
          "Once a request is approved, the tool's pickup location is shared with the borrower, and a return date is agreed.",
          "Either of you can mark a tool returned once it's back.",
          "If you can no longer lend or borrow after approving, say so promptly in the app's messages. There's no penalty — just don't leave someone waiting.",
        ]}
      />
      <P>
        Approving a request isn't a binding contract to hand the tool over,
        and asking isn't a binding commitment to collect it. Be a good
        neighbor about it.
      </P>

      <H>If a tool isn't returned</H>
      <P>
        Once a loan is past its agreed return date, we remind both of you{" "}
        <b>daily</b> until the tool comes back. That's the extent of what we
        do: <b>we don't recover tools, chase borrowers, or reimburse
        owners.</b>
      </P>
      <P>
        If a tool isn't returned, the owner can report the borrower through
        Toolber, which we'll act on — and, if they believe the tool has been
        stolen, contact local law enforcement. That's a decision for the
        owner, not for us, and reporting someone here is not a substitute for
        it.
      </P>

      <H>What you may not list or do</H>
      <UL
        items={[
          "Firearms, ammunition, explosives, or anything requiring a licence to operate.",
          "Anything you don't own or have the right to lend.",
          "Anything you know to be unsafe.",
          "Harassment, threats, or discrimination against other users.",
          "Using another person's account, or misrepresenting who you are.",
          "Scraping, automating, or attacking the service.",
        ]}
      />
      <P>
        You can report another user from their profile or from any borrow
        request. We may suspend or remove any account at our discretion.
      </P>

      <H>Your content</H>
      <P>
        Your listings, photos and messages stay yours. You give us permission
        to display them within Toolber so the service can work. You confirm
        you have the right to post what you post.
      </P>

      <H>Disputes between neighbors</H>
      <P>
        If something goes wrong between you and another user, that's between
        the two of you. <b>We don't mediate, arbitrate, or take sides</b>, and
        we're not obliged to get involved. We will act on reports of unsafe or
        abusive behaviour, because that affects everyone.
      </P>

      <H>Limits on our liability</H>
      <P>
        To the fullest extent the law allows, our total liability to you for
        anything arising out of Toolber is limited to the greater of{" "}
        <b>$100</b> or the amount you paid us in the twelve months before
        the claim. As we don't currently charge for anything, that is likely{" "}
        <b>$100</b>.
      </P>
      <P>
        We're not liable for indirect, incidental, or consequential damages —
        lost work, lost income, or the cost of hiring someone else.
      </P>
      <P>
        The service is provided "as is". We don't promise it will always be
        available, or that listings are accurate.
      </P>

      <H>Changes and closing your account</H>
      <P>
        You can stop using Toolber at any time. To delete your account, email{" "}
        <b>legal@toolber.org</b>.
      </P>
      <P>
        If we change these terms materially, we'll tell you before the change
        takes effect and ask you to accept the new version.
      </P>

      <H>Governing law</H>
      <P>
        These terms are governed by the laws of the <b>State of Delaware</b>,
        where Platow Inc. is incorporated.
      </P>

      <H>If you have a dispute with us</H>
      <P>
        This section is about disputes with <b>Platow Inc.</b> — not disputes
        with another neighbor, which are covered above and which we stay out
        of.
      </P>
      <P>
        If we can't sort something out directly, it will be resolved by{" "}
        <b>binding arbitration on an individual basis</b>, rather than in
        court. You and Platow Inc. each give up the right to a jury trial and
        the right to take part in a class action.
      </P>
      <P>
        <b>Small claims are the exception.</b> Either of us can still bring a
        qualifying claim in small-claims court instead, and nothing here stops
        you doing that. For most disagreements between a neighbor and a small
        company, that's the cheaper and faster route anyway.
      </P>
      <P>
        Arbitration is administered by{" "}
        <b>[ARBITRATION PROVIDER — attorney to specify]</b> under its consumer
        rules. <b>[OPT-OUT WINDOW — attorney to advise]</b>
      </P>

      <H>Contact</H>
      <P>
        <b>Platow Inc.</b>
        <br />
        <b>8 The Green, Ste B<br />Dover, DE 19901</b>
        <br />
        <b>legal@toolber.org</b>
      </P>
    </LegalPage>
  );
}
