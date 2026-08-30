import LegalPage, { H, P, UL } from "../components/LegalPage";

// DRAFT — not reviewed by an attorney. See docs/legal-checklist.md.
//
// Written from the actual schema rather than a template, so every claim here
// is checkable against the code. If you change what the app stores, this page
// is wrong until you update it.
export const PRIVACY_VERSION = "draft-2026-08-29";

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" version={PRIVACY_VERSION}>
      <P>
        Short version: we collect what Toolber needs to work, we don't sell it,
        and we're careful with the two things that could actually hurt you —
        your home address and your exact pickup location.
      </P>

      <H>What we collect</H>
      <P>When you make an account:</P>
      <UL
        items={[
          "Your email address and a password, handled by our authentication provider. We never see your password.",
          "A display name, shown to other neighbors.",
          "Optionally, a phone number.",
        ]}
      />
      <P>When you set up your chest:</P>
      <UL
        items={[
          "Your home location, which we use once to calculate a deliberately fuzzed map pin.",
          "That fuzzed pin, which is the only location other people ever see.",
        ]}
      />
      <P>When you use the app:</P>
      <UL
        items={[
          "Your tool listings, including photos, condition, and the pickup location you enter.",
          "Borrow requests, approvals, return dates.",
          "Messages you send to other users.",
          "Reports you file about other users.",
          "Basic usage events — which screens get used, which searches get run — so we can tell what's working.",
        ]}
      />

      <H>The two things we're careful about</H>
      <P>
        <b>Your home coordinates are never shown to anyone.</b> Not to other
        users, not on the map, not in any API response. They exist only to
        calculate your public pin, and that calculation happens once. Your pin
        is a random point near your home, snapped to a plausible street — and
        it never moves. That last part is deliberate: a pin that re-randomised
        on every view could be averaged out over time to reveal exactly where
        you live.
      </P>
      <P>
        <b>Your exact pickup address is shared only with someone whose borrow
        request you personally approved</b>, and only for 30 days. Not with
        everyone in your group. Not with people browsing. Approving a request
        is what reveals it, and marking the tool returned ends that.
      </P>
      <P>
        You can also hide your pin entirely in Settings. Your tools stay
        searchable; they just don't appear on the map.
      </P>

      <H>What other neighbors can see</H>
      <UL
        items={[
          "Your display name and your tool listings.",
          "Your approximate map pin, unless you've hidden it.",
          "Messages you send them.",
          "Your email address and phone number — but only someone on the other side of a borrow request you approved, so you can arrange the handover.",
        ]}
      />
      <P>
        They cannot see your home coordinates, your pickup addresses (unless
        approved), your asking price on a for-sale tool, or any group's invite
        code unless they're a member.
      </P>

      <H>Who we share data with</H>
      <P>
        We don't sell your data. We don't share it for advertising. We use no
        third-party analytics — the usage events described above are stored in
        our own database and read by us alone.
      </P>
      <P>We do rely on these services to run Toolber:</P>
      <UL
        items={[
          "Supabase — database, sign-in, and file storage.",
          "Cloudflare — hosting, and the anti-bot check on sign-in.",
          "Mapbox — map rendering. Your browser talks to them to draw the map.",
          "Resend — sending notification emails.",
        ]}
      />
      <P>
        We may also disclose information if the law requires it, or to protect
        someone's safety.
      </P>

      <H>Email you'll get</H>
      <P>
        We email you about things happening on your account — a borrow
        request, an approval, an overdue tool. You can turn categories of
        these off; account and security emails always send.
      </P>

      <H>Your choices</H>
      <UL
        items={[
          "Edit or delete any listing at any time.",
          "Hide your map pin, or change how far your pin is offset from your home.",
          "Turn off categories of notification email.",
          "Ask for a copy of your data, or ask us to delete it.",
        ]}
      />
      <P>
        To request a copy or deletion, email <b>[PRIVACY EMAIL]</b>. We'll
        respond within <b>[30 DAYS]</b>.{" "}
        <b>
          [NOTE: self-serve account deletion is not built yet — see
          docs/legal-checklist.md item F2]
        </b>
      </P>

      <H>How long we keep things</H>
      <P>
        We keep your account and listings while your account is open. If you
        ask us to delete your account, we remove it within <b>[30 DAYS]</b>,
        except anything we're required to keep or that's needed to resolve an
        open dispute.
      </P>
      <P>
        Messages and borrow history involve two people, so deleting your
        account doesn't erase the other person's copy of a conversation.
      </P>

      <H>Children</H>
      <P>
        Toolber is for adults. You must be 18 or older, and we don't knowingly
        collect information from anyone younger. If you believe a child has
        given us information, email <b>[PRIVACY EMAIL]</b> and we'll remove it.
      </P>

      <H>Security</H>
      <P>
        Passwords are hashed by our authentication provider and never visible
        to us. The site is served over HTTPS. Sensitive columns — home
        coordinates, pickup addresses — are protected at the database level,
        not just hidden in the interface.
      </P>
      <P>
        No service is perfectly secure, and we won't pretend otherwise. If you
        find a problem, please tell us at <b>[PRIVACY EMAIL]</b>.
      </P>

      <H>Changes</H>
      <P>
        If we change this policy materially, we'll tell you before it takes
        effect.
      </P>

      <H>Contact</H>
      <P>
        <b>[LEGAL ENTITY NAME]</b>
        <br />
        <b>[REGISTERED ADDRESS]</b>
        <br />
        <b>[PRIVACY EMAIL]</b>
      </P>
    </LegalPage>
  );
}
