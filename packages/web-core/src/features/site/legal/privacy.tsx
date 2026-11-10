import Link from "next/link";

import { BRAND } from "../brand";
import { LegalDocument, type LegalSection } from "./legal-document";

const n = BRAND.name;

const SECTIONS: LegalSection[] = [
  {
    id: "who-we-are",
    title: "Who we are and our role",
    body: (
      <>
        <p>
          {n} is operated by {BRAND.legalEntity}, a company registered in {BRAND.jurisdiction} at
          [registered address] (&quot;we&quot;, &quot;us&quot;). This policy explains how we process
          personal data in line with the Digital Personal Data Protection Act, 2023, the Information
          Technology Act, 2000 and the rules made under them.
        </p>
        <ul>
          <li>
            For <strong>account data</strong> (owners and staff who sign in), we decide how the data
            is used and act as the Data Fiduciary.
          </li>
          <li>
            For <strong>restaurant operational data</strong> — menus, tables, orders, bills and the
            limited data of guests who order by QR code — the restaurant (our customer) decides why
            it is collected. We process it on the restaurant&apos;s behalf as a Data Processor.
            Guests should contact the restaurant first about that data.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "what-we-collect",
    title: "Data we collect",
    body: (
      <ul>
        <li>
          <strong>Account data:</strong> name, email address, a one-way hash of your password, the
          workspaces you belong to and your role.
        </li>
        <li>
          <strong>Business data:</strong> restaurant and branch names, addresses, contact details,
          tax identifiers (such as GSTIN) and settings you enter.
        </li>
        <li>
          <strong>Operational data:</strong> menus, tables, orders, kitchen status, bills, and
          payments recorded by your cashiers (amount, method and reference — we do not receive card
          numbers or UPI credentials).
        </li>
        <li>
          <strong>Guest data:</strong> guests can order without an account. We store the items
          ordered, the table and a session cookie that links the guest&apos;s phone to that table
          visit, plus any note the guest types.
        </li>
        <li>
          <strong>Technical data:</strong> IP address, browser and device type, request logs, and an
          audit trail of important actions taken in a workspace.
        </li>
        <li>
          <strong>Communications:</strong> emails and support requests you send us.
        </li>
      </ul>
    ),
  },
  {
    id: "how-we-use",
    title: "How we use data",
    body: (
      <ul>
        <li>To provide the service: sign-in, ordering, kitchen display, billing and analytics.</li>
        <li>
          To send service emails: email verification, password resets, staff invitations, trial and
          subscription notices.
        </li>
        <li>To keep the service secure: rate limiting, fraud and abuse prevention, audit logs.</li>
        <li>To provide support and respond to your requests.</li>
        <li>
          Only with your permission: to understand how people find us and which pages and features
          they use, so we can improve them (see <a href="#cookies">Cookies and on-device storage</a>
          ).
        </li>
        <li>To meet legal, tax and accounting obligations.</li>
      </ul>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and on-device storage",
    body: (
      <>
        <p>
          <strong>Necessary.</strong> These are always used, because the service does not work
          without them:
        </p>
        <ul>
          <li>A secure, HTTP-only session cookie that keeps staff signed in.</li>
          <li>A guest cookie that links a guest&apos;s phone to the current table session.</li>
          <li>
            A cookie that remembers your analytics choice (<code>ros_analytics_consent</code>, 180
            days), so we do not ask on every page.
          </li>
          <li>
            Browser storage used for offline support — previously loaded menus, drafts and carts are
            kept on the device until they sync or are cleared.
          </li>
        </ul>
        <p>
          <strong>Optional analytics (Google Analytics).</strong> Used only if you choose
          &ldquo;Allow analytics&rdquo; on our website, sign-in pages or dashboard. Nothing is sent
          to Google before that, and nothing if you decline or ignore the question.
        </p>
        <ul>
          <li>
            Cookies: Google Analytics cookies (<code>_ga</code> and <code>_ga_…</code>, up to 180
            days) holding a random identifier for your browser, and a marker for the first page of
            each visit kept in the tab until it closes.
          </li>
          <li>
            From your browser: the pages you visit (with account, restaurant and invitation
            identifiers removed from the addresses), campaign tags in the link that brought you, and
            which features you use — signing up or in, creating a workspace, restaurant, branch or
            menu item, generating a table QR code, opening the upgrade dialog and starting a
            checkout (with the plan, billing cycle and list price).
          </li>
          <li>
            From our servers, for the same people only: that your free trial started (plan and trial
            length) and that a payment was confirmed (plan, billing cycle, price, whether it renewed
            an active plan) and activated your subscription. These are linked to the random
            identifier in your <code>_ga</code> cookie. So that a payment confirmed by our payment
            provider after you have left the page can still be counted, we keep that identifier with
            the payment record until the payment is confirmed, and then delete it.
          </li>
          <li>
            Never sent: your name, email address, phone number, password, payment details, your
            restaurant&apos;s menu, orders or sales, or account and restaurant identifiers.
            Advertising features and Google signals are switched off, and Google states that Google
            Analytics does not log or store IP addresses. Google keeps this data for up to 14
            months.
          </li>
        </ul>
        <p>
          You can withdraw at any time from &ldquo;Cookie settings&rdquo; at the bottom of the
          website and sign-in pages, or in your account menu once signed in. Withdrawing deletes the
          Google Analytics cookies on that device, stops every open tab, and stops our servers from
          sending further events about you (a payment for a checkout you started while analytics was
          allowed may still be counted once). Guests ordering from a table QR code are never asked
          and never get analytics cookies.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Who we share data with",
    body: (
      <>
        <p>We do not sell personal data. We share it only with:</p>
        <ul>
          <li>
            Service providers that host the service, store files and deliver email, under contracts
            that require them to protect the data: [list providers and the countries where they
            process data].
          </li>
          <li>
            Google (Google Analytics), only for people who chose &ldquo;Allow analytics&rdquo;, and
            only the data described under <a href="#cookies">Cookies and on-device storage</a>.
            Google processes it on servers that may be outside India, including in the United
            States.
          </li>
          <li>Authorities, where required by law or a valid legal request.</li>
          <li>A successor business, if {n} is merged or sold, with notice to you.</li>
        </ul>
      </>
    ),
  },
  {
    id: "security",
    title: "How we protect data",
    body: (
      <p>
        Data is encrypted in transit. Passwords are stored only as one-way hashes. Each
        workspace&apos;s data is isolated from other customers, staff access is limited by role, and
        important actions are recorded in audit logs. No system is perfectly secure; if a personal
        data breach occurs we will notify affected users and the Data Protection Board of India as
        the law requires.
      </p>
    ),
  },
  {
    id: "retention",
    title: "Data retention",
    body: (
      <>
        <ul>
          <li>
            <strong>While your subscription is active</strong>, we keep your data for as long as you
            use the service.
          </li>
          <li>
            <strong>When a trial or subscription expires or is cancelled</strong>, your data is{" "}
            <strong>preserved, not automatically deleted</strong>. Access to the workspace is
            restricted (for example, read-only) until a plan is activated again.
          </li>
          <li>
            <strong>Deletion on request:</strong> a workspace owner can ask us to delete the
            workspace and its data at any time by emailing {BRAND.supportEmail}. We complete
            deletion within [30] days of verifying the request.
          </li>
          <li>
            <strong>Inactive workspaces:</strong> if a workspace stays expired for more than [24]
            months, we may delete it after giving the owner at least [30] days&apos; notice by
            email.
          </li>
          <li>
            Backups are overwritten on a rolling basis within [35] days. Records we must keep by law
            (for example tax invoices for our subscription fees) are retained for the period the law
            requires.
          </li>
        </ul>
        <p>
          Restaurants decide how long their guests&apos; order data is kept, within the limits
          above.
        </p>
      </>
    ),
  },
  {
    id: "your-rights",
    title: "Your rights",
    body: (
      <>
        <p>Subject to applicable law, you can:</p>
        <ul>
          <li>access a summary of the personal data we hold about you;</li>
          <li>correct or update inaccurate data (most of it directly in your account);</li>
          <li>ask us to erase your data, where we are not required to keep it;</li>
          <li>withdraw consent where processing is based on consent;</li>
          <li>nominate another person to exercise your rights in case of death or incapacity;</li>
          <li>raise a grievance with us, and then with the Data Protection Board of India.</li>
        </ul>
        <p>Email {BRAND.supportEmail} to make a request. We respond within [30] days.</p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        Staff accounts are for adults (18+). The service is not directed at children. Restaurants
        are responsible for how they serve guests who are minors.
      </p>
    ),
  },
  {
    id: "grievance",
    title: "Grievance officer and contact",
    body: (
      <p>
        Grievance Officer: [Name], [Designation], {BRAND.legalEntity}, [address]. Email:{" "}
        {BRAND.supportEmail}. We acknowledge grievances within [48 hours] and aim to resolve them
        within [30] days.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        We will post changes on this page and, for material changes, notify workspace owners by
        email before they take effect. See also our{" "}
        <Link href="/legal/terms">terms of service</Link>.
      </p>
    ),
  },
];

export function PrivacyPolicy() {
  return (
    <LegalDocument
      title="Privacy policy"
      currentHref="/legal/privacy"
      summary={
        <p>
          In short: we collect what we need to run {n} for your restaurant, we never sell it, and
          your data stays yours — it is kept when a subscription ends and deleted when you ask.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
