import Link from "next/link";

import { BRAND } from "../brand";
import { LegalDocument, type LegalSection } from "./legal-document";
import { LegalEntity, SupportEmail } from "../site-contact";

const n = BRAND.name;

const SECTIONS: LegalSection[] = [
  {
    id: "agreement",
    title: "Agreement",
    body: (
      <p>
        These terms form an agreement between <LegalEntity /> (&quot;we&quot;) and the business or
        person that creates a {n} workspace (&quot;you&quot;). By creating an account or using the
        service you accept these terms and our <Link href="/legal/privacy">privacy policy</Link>. If
        you accept on behalf of a business, you confirm you are authorised to do so.
      </p>
    ),
  },
  {
    id: "service",
    title: "The service",
    body: (
      <>
        <p>
          {n} provides software for restaurants: QR table ordering, waiter approval, a kitchen
          display, counter billing, menu, table and staff management, analytics and audit logs,
          across multiple restaurants and branches.
        </p>
        <p>The following are not currently part of the service:</p>
        <ul>
          <li>online payment collection (payments are recorded at the counter);</li>
          <li>delivery and takeaway ordering;</li>
          <li>native mobile apps (an installable web app is provided);</li>
          <li>integrations with POS hardware.</li>
        </ul>
        <p>
          Offline support is limited: staff screens already loaded on a device keep working, and
          waiter orders and kitchen updates made offline are queued and sent once the device is back
          online. Guest QR ordering, approving orders, billing and confirming payments require a
          connection.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Accounts and staff",
    body: (
      <ul>
        <li>
          Keep your login details confidential and tell us promptly about any unauthorised use.
        </li>
        <li>
          The workspace owner is responsible for the staff they invite, the roles they assign and
          everything done in the workspace.
        </li>
        <li>You must provide accurate information and keep it up to date.</li>
      </ul>
    ),
  },
  {
    id: "trial",
    title: "Free trial",
    body: (
      <p>
        New workspaces get a free trial for the period shown at sign-up ([30] days by default). No
        payment is required for the trial and nothing is charged automatically when it ends. Trial
        features and limits may differ from paid plans.
      </p>
    ),
  },
  {
    id: "fees",
    title: "Plans, fees and taxes",
    body: (
      <ul>
        <li>
          Plans, prices and limits are those shown on our <Link href="/pricing">pricing page</Link>{" "}
          or in a written quote at the time you subscribe.
        </li>
        <li>
          Subscriptions are activated manually by our team after we receive payment by [bank
          transfer / UPI / other method]. We issue a tax invoice for each payment.
        </li>
        <li>Fees are exclusive of GST and other applicable taxes unless stated otherwise.</li>
        <li>
          We may change prices for future billing periods with at least [30] days&apos; notice.
        </li>
        <li>
          Cancellations and refunds follow our{" "}
          <Link href="/legal/refunds">cancellation &amp; refund policy</Link>.
        </li>
      </ul>
    ),
  },
  {
    id: "your-responsibilities",
    title: "Your responsibilities",
    body: (
      <ul>
        <li>
          Menu content, prices, tax rates, service charges and the bills you issue are your
          responsibility. {n} calculates bills from the settings you configure; please check them.
        </li>
        <li>
          You are responsible for complying with laws that apply to your restaurant, including food
          safety, consumer protection, tax and data-protection obligations towards your guests.
        </li>
        <li>
          {n} records payments but does not process them. Disputes about payments to your restaurant
          are between you and your guest.
        </li>
      </ul>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <p>
        Do not misuse the service: no unlawful content, no attempts to access other customers&apos;
        data, no probing, scraping or overloading the service, no reselling without our written
        permission, and no use that breaches the Information Technology Act, 2000.
      </p>
    ),
  },
  {
    id: "data",
    title: "Your data",
    body: (
      <>
        <p>
          You own the data you put into {n}. You give us permission to host and process it only to
          provide and improve the service, as described in the privacy policy.
        </p>
        <p>
          If your subscription ends, your data is preserved and not automatically deleted; access is
          restricted until a plan is reactivated. You can ask us to delete it at any time.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    title: "Availability and changes",
    body: (
      <p>
        We work to keep {n} available and secure but do not guarantee uninterrupted service. We may
        perform maintenance and improve or change features; we will give reasonable notice of
        changes that materially reduce the service you pay for. [Insert service level commitments,
        if any.]
      </p>
    ),
  },
  {
    id: "suspension",
    title: "Suspension and termination",
    body: (
      <p>
        You can stop using the service at any time. We may suspend or terminate a workspace for
        non-payment, serious or repeated breach of these terms, or where required by law, with
        notice where reasonably possible.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Disclaimers and limitation of liability",
    body: (
      <>
        <p>
          To the extent permitted by law, the service is provided &quot;as is&quot;. We are not
          liable for indirect or consequential losses such as lost profits or revenue.
        </p>
        <p>
          Our total liability for any claim is limited to the fees you paid us in the [12] months
          before the claim arose.
        </p>
      </>
    ),
  },
  {
    id: "law",
    title: "Governing law and disputes",
    body: (
      <p>
        These terms are governed by the laws of India. Courts at [City], India have exclusive
        jurisdiction, subject to any mandatory consumer protection rights. [Consider adding an
        arbitration clause under the Arbitration and Conciliation Act, 1996.]
      </p>
    ),
  },
  {
    id: "contact",
    title: "Changes and contact",
    body: (
      <p>
        We may update these terms and will notify workspace owners of material changes by email
        before they take effect. Contact us at <SupportEmail />.
      </p>
    ),
  },
];

export function TermsOfService() {
  return (
    <LegalDocument
      title="Terms of service"
      currentHref="/legal/terms"
      summary={
        <p>
          The rules for using {n}: what the service includes, what you&apos;re responsible for, how
          subscriptions work and what happens to your data.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
