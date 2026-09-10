import { Link } from "react-router-dom";
import LegalPage, { H, OL, P, UL } from "../components/LegalPage";

/**
 * How the app works, and how to lend to a stranger without regretting it.
 *
 * Written because several of Toolber's most deliberate decisions are invisible
 * until they surprise someone: approving a request does *not* hand over your
 * address, your map pin is a random point rather than your house, and the app
 * is not a party to the loan and carries no insurance. People work those out
 * eventually, usually at the worst moment.
 *
 * Two things this page is careful not to be:
 *
 * - **A safety guarantee.** It offers habits, not assurances. Promising that
 *   following them keeps anyone safe would be false, and would sit badly
 *   against the Terms, which say plainly that Platow is not part of the loan.
 * - **A second copy of the Terms.** Where something is a rule rather than a
 *   suggestion, this says so briefly and links. Two documents describing the
 *   same obligation in different words is how they end up contradicting each
 *   other.
 *
 * Public, and reachable before signup, because "what does this actually do
 * with my address" is a question people have *before* they hand it over.
 */
export default function Guide() {
  return (
    <LegalPage title="Using Toolber">
      <P>
        Toolber is neighbors lending each other tools — you, the person you're
        lending to, and some software that makes finding each other and keeping
        track easier. Most of this page is about the part the software doesn't
        do, and how people handle it well.
      </P>

      <H>The short version</H>
      <UL
        items={[
          "List a tool. It's searchable by anyone with an account, everywhere — not just your street.",
          "Someone asks to borrow it. Every request comes to you, and nothing happens until you say yes.",
          "You approve. This does not hand over your address — see below.",
          "You agree on a pickup spot, then meet and hand it over.",
          "They return it and someone marks it returned, which frees the tool for the next person.",
        ]}
      />

      <H>How to list a tool</H>
      <OL
        items={[
          "Go to My Tools and tap List Something.",
          "Name it the way someone would search for it — \"heat gun\", not the model number. A plain name also lets the app guess the category for you.",
          "Pick a category. If the guess under the box looks right, tap it; otherwise type into the picker, which searches subcategories too.",
          "Say what condition it's in — new, good or fair. Fair is honest, not embarrassing.",
          "Add up to three photos. Optional, but a tool with a picture gets asked for far more often. If one comes out sideways, the rotate arrow on the thumbnail turns it.",
          "Say whether it's portable. If it isn't, you can require that you're there when it's used.",
          "Leave it free, or set a price. You can also mark it open to sell, which lets people inquire.",
          "Enter a pickup location. This is private — nobody sees it until you approve their specific request, and even then only if you share it. If you saved a default address in Settings, tick the box instead of typing.",
          "Decide whether approving someone shares that exact address automatically, or whether you'd rather send a spot yourself each time.",
          "Set how long you usually lend it for. A borrower can ask for something different, and you can shorten it when you approve.",
          "Tap List This Tool. It's searchable immediately.",
        ]}
      />
      <P>
        Editing later is the same form — <b>Manage</b> on the listing, then{" "}
        <b>Edit details</b>. Pausing a listing hides it from search without
        deleting anything, which is what to do when a tool is away being
        repaired.
      </P>

      <H>How to borrow a tool</H>
      <OL
        items={[
          "Search for what you need. You can look without an account; you need one to ask. Use Search near if you want distances measured from somewhere other than your own area.",
          "Open the tool and read it over — condition, whether the owner needs to be present, and whether it's free.",
          "Tap Request Borrow. Choose how many days you need, and write a short note saying what you're doing with it. The note matters more than you'd think: it's often all the owner has to go on.",
          "Tick the walkthrough box if you'd like to be shown how it works. It doesn't affect whether you're approved — it just tells the owner to allow ten minutes.",
          "Wait for the owner. They'll approve or decline, and you'll be notified either way. You can message them before they decide, and a declined request usually just means that tool at that moment.",
          "Once approved, tap Request pickup. The owner answers with an address or a one-off meeting spot — approval on its own doesn't reveal where they live.",
          "Collect it. Look it over together, so you both agree what condition it started in.",
          "Bring it back by the due date. Either of you can tap Mark tool returned, which frees it for the next person.",
        ]}
      />
      <P>
        Changed your mind before they've answered? <b>Withdraw request</b> on
        the request in My Tools. After it's approved, message them — ending an
        approved loan is <b>Mark tool returned</b>.
      </P>

      <H>What other people can see about you</H>
      <P>
        Your display name, your photo if you added one, and the tools you've
        listed. Plus an approximate location on the map.
      </P>
      <P>
        <b>The map pin is not your house.</b> When you set your default location
        we take the address, pick a random point within the radius you chose, and
        keep only that point. Your actual address is never on the map and never
        shown to anyone by the map. Nobody can work backwards from the pin,
        because the real coordinates aren't in anything the app hands out.
      </P>
      <P>
        <b>Not shown to anyone, ever, without you deciding:</b> your address,
        your email, your phone number. Those are separate choices you make in
        Settings, and they only reach someone whose specific request you've
        already approved.
      </P>

      <H>Approving is not the same as sharing your address</H>
      <P>
        This one surprises people, so it's worth reading twice. When you approve
        a request, the borrower learns that you said yes — <i>and nothing about
        where you live</i>.
      </P>
      <P>
        Arranging the handover is a separate step. The borrower asks for a pickup
        spot, and you answer with either your saved address or a one-off place
        you type just for them: a café, a parking lot, the corner of your street.
        You can lend a tool without ever telling anyone your address.
      </P>

      <H>Deciding who to lend to</H>
      <P>
        You'll get requests from people you don't know. That's the app working,
        not a problem — but it means the decision is yours to make with
        something. A few things help:
      </P>
      <UL
        items={[
          "Read the note. Borrowers can write one with their request, and someone who explains what they're doing is telling you something.",
          "Look for shared groups. If you're both in a neighborhood group, someone already vouched for them enough to let them in.",
          "Just ask. There's a link on every pending request to message the person before deciding. A two-message conversation tells you more than any profile.",
          "Say no if you want to. Denying is one tap, and you can add a reason or not. \"I'd rather not lend this one out\" is a complete answer.",
        ]}
      />

      <H>Habits worth having</H>
      <P>
        None of this is required, and none of it is a guarantee. It's what tends
        to go wrong, and what tends to prevent it.
      </P>
      <UL
        items={[
          "Meet somewhere you're comfortable. Daylight, somewhere public, or with someone else at home. A one-off pickup spot exists exactly so you never have to choose between lending and privacy.",
          "Look at the tool together, both ways. Two minutes at handover, two at return. It's much easier to agree something was already chipped while you're both holding it.",
          "Say out loud what happens if it breaks. Toolber is not part of your loan and carries no insurance, so whatever the two of you agree is the whole arrangement. Deciding beforehand is far easier than deciding afterwards.",
          "Don't lend what you can't afford to lose. Some tools are worth the risk and some aren't, and only you know which is which.",
          "Trust the feeling. If a conversation is off, deny the request. You never owe anyone an explanation, and there is no rating to protect.",
          "Report anyone who makes you uneasy. It's in the chat with them, goes only to us, and doesn't tell them anything.",
        ]}
      />

      <H>Tools that need more than handing over</H>
      <P>
        Some things shouldn't leave your garage — a bench saw, anything bolted
        down, anything you'd wince at seeing used unsupervised. You can mark a
        borrower as needing you present for a specific tool, and that sticks for
        next time rather than being asked again each loan.
      </P>
      <P>
        Borrowers can also tick a box asking for a quick walkthrough. It's a
        signal, not a condition — it doesn't change anything about approval, it
        just tells you to allow ten minutes.
      </P>

      <H>Getting it back</H>
      <UL
        items={[
          "Loans have a return date. You set your usual length per tool, the borrower can ask for a different one, and you can shorten it when you approve.",
          "Both of you get a reminder when it's overdue. Nothing else happens automatically — chasing it is a conversation, not an enforcement system.",
          "Either of you can mark it returned. That's what frees the tool for the next person, so it's worth doing the same day.",
          "Overdue isn't the end. Most late returns are somebody's week getting away from them. Message before assuming.",
        ]}
      />

      <H>Groups</H>
      <P>
        Groups are for people who already trust each other — a street, a
        building, a maker space. You don't need one to use Toolber; search covers
        everything regardless. What a group gives you is context: when a request
        comes from someone in a group you share, you know something about them.
      </P>
      <P>
        If someone sent you an invite code, go to <b>Groups → Find a Group</b>{" "}
        and enter it in the "Have an invite code?" field. That joins you straight
        away. Without a code, find the group in the same list and use{" "}
        <b>Request to Join</b>, which waits for an admin.
      </P>
      <P>
        Not every group is in that list. A group's admin can keep it{" "}
        <b>unlisted</b>, which means it doesn't appear in Find a Group and can
        only be joined by someone sent the invite code — sensible for a single
        street, or a workshop's regulars, where the point is the people you
        already know. If you run a group, the switch is on its page. Unlisted
        is about not being advertised rather than being secret: members can
        obviously see it, and the code works for anyone you give it to.
      </P>

      <H>Money</H>
      <P>
        You can list a tool as free or put a price on it, and you can mark one as
        for sale. Toolber doesn't process any payments — anything involving money
        is settled directly between the two of you, however you like. If you do
        charge, what you owe in tax is your business and not something the app
        works out for you.
      </P>

      <H>Controls worth knowing about</H>
      <UL
        items={[
          "Your default location — where search measures distance from, and roughly where your tools appear. Change it any time in Settings; the pin moves to a new random point.",
          "Pin radius — how far your pin can land from you. A tighter radius is a more useful pin but a smaller area to be anywhere in, and the trade-off is steeper than it looks: halving the radius quarters the area.",
          "Hide my pin — keeps your tools searchable but off the map entirely.",
          "Show my tools as a collection — a single page of everything you lend. Turning it off doesn't hide any tool; each one is still findable on its own.",
          "Email and push — separate switches, both on by default. Turn off whichever is too much.",
          "Delete your account — in Settings. It won't let you while a loan is still open, which is deliberate.",
        ]}
      />

      <H>Questions people actually ask</H>
      <P>
        <b>Can someone find out where I live?</b> Not from the app. The map shows
        a random point near you, and your address only reaches someone you've
        approved and chosen to share it with — and you can use a one-off pickup
        spot instead.
      </P>
      <P>
        <b>Do I have to lend to anyone who asks?</b> No. Every request needs your
        approval, and you can deny any of them without a reason.
      </P>
      <P>
        <b>What if my tool comes back broken, or doesn't come back?</b> That's
        between you and the borrower. Toolber isn't a party to the loan and
        doesn't carry insurance, which is exactly why agreeing beforehand is
        worth the two minutes. The{" "}
        <Link to="/terms" className="font-semibold text-racing underline">
          Terms
        </Link>{" "}
        set out where that leaves everyone.
      </P>
      <P>
        <b>Can I lend outside my neighborhood?</b> Yes. Search is global, and
        results are ordered by distance from your default location rather than
        filtered by it. Someone three towns over can find your tool; whether you
        want to lend that far is your call.
      </P>
      <P>
        <b>Do I need an account to look?</b> No — searching and looking at a tool
        work signed out. You need an account to request one, and you have to be
        18 or older.
      </P>

      <H>Notifications on an iPhone</H>
      <P>
        Apple only allows web apps to send notifications once they've been{" "}
        <b>added to the Home Screen</b>. Until you do that, Toolber can't notify
        you on an iPhone at all — and the push switch doesn't appear in
        Settings, because there'd be nothing behind it.
      </P>
      <P>
        In Safari, tap <b>Share</b> (the square with an arrow pointing up), then{" "}
        <b>Add to Home Screen</b>. Open Toolber from that icon afterwards and
        the switch will be there. On Android there's nothing to do — push works
        in the browser, and installing is optional.
      </P>

      <H>Two accounts on one computer</H>
      <P>
        You can only be signed in as one person per browser at a time. Toolber
        remembers who you are in the browser's own storage, and every tab of the
        same browser shares it — so signing out in one tab signs you out in all
        of them, and signing in makes every tab that person. There's a{" "}
        <b>Switch account</b> option in the account menu for changing over.
      </P>
      <P>
        If you genuinely need two at once — testing something, or sharing a
        laptop with someone who won't wait — open a second browser profile or a
        private/incognito window. Those have separate storage, so they can hold
        separate sessions.
      </P>

      <H>If something goes wrong</H>
      <P>
        Report a person from the chat with them. There's a feedback button on
        every screen for anything else — bugs, ideas, something that reads badly.
        Both reach us directly.
      </P>
      <P>
        For what's binding rather than suggested, read the{" "}
        <Link to="/terms" className="font-semibold text-racing underline">
          Terms of Service
        </Link>{" "}
        and the{" "}
        <Link to="/privacy" className="font-semibold text-racing underline">
          Privacy Policy
        </Link>
        . Where this page and those disagree, those win — they're the agreement,
        this is the explanation.
      </P>
    </LegalPage>
  );
}
