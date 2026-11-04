import Link from "next/link";

import { BRAND } from "../brand";
import { LegalDocument, type LegalSection } from "./legal-document";

const n = BRAND.name;

const SECTIONS: LegalSection[] = [
  {
    id: "how-billing-works",
    title: "How subscriptions are billed",
    body: (
      <p>
        {n} subscriptions are activated manually. You choose a plan and billing period (monthly or
        annual), pay by [bank transfer / UPI / other method], and our team activates the
        subscription and sends a tax invoice. We do not store card details and nothing renews or
        charges automatically.
      </p>
    ),
  },
  {
    id: "trial",
    title: "Free trial",
    body: (
      <p>
        The free trial costs nothing and needs no payment details. When it ends, the workspace is
        restricted until a plan is activated — no charge is made.
      </p>
    ),
  },
  {
    id: "cancellation",
    title: "Cancelling",
    body: (
      <ul>
        <li>
          Email {BRAND.supportEmail} from the workspace owner&apos;s address to cancel. You can also
          simply not renew.
        </li>
        <li>
          Cancellation takes effect at the end of the period you have paid for. You keep full access
          until then.
        </li>
        <li>
          After that, the workspace is restricted (for example, read-only). Your data is preserved,
          not automatically deleted — see the{" "}
          <Link href="/legal/privacy#retention">retention section of our privacy policy</Link>.
        </li>
      </ul>
    ),
  },
  {
    id: "refunds",
    title: "Refunds",
    body: (
      <ul>
        <li>
          <strong>Monthly plans:</strong> fees are non-refundable once the billing month has
          started.
        </li>
        <li>
          <strong>Annual plans:</strong> if you cancel within [14] days of activation, we refund the
          full amount. After that, we refund [the unused full months, less any discount received /
          nothing], unless the law requires otherwise.
        </li>
        <li>
          <strong>Duplicate or mistaken payments:</strong> refunded in full once verified.
        </li>
        <li>
          <strong>Extended outages:</strong> if the service is unavailable for a significant period
          due to our fault, we may offer a credit or partial refund at our discretion. [Align with
          any service level commitment.]
        </li>
      </ul>
    ),
  },
  {
    id: "processing",
    title: "How refunds are paid",
    body: (
      <p>
        Approved refunds are paid to the original payment source within [7–10] business days. Taxes
        are adjusted with a credit note as required under GST law.
      </p>
    ),
  },
  {
    id: "plan-changes",
    title: "Upgrades and downgrades",
    body: (
      <p>
        Upgrades take effect once the difference is paid [pro-rated for the remaining period].
        Downgrades take effect from the next billing period; if your usage exceeds the new
        plan&apos;s limits, you will need to reduce it before the downgrade.
      </p>
    ),
  },
  {
    id: "guests",
    title: "Payments made by restaurant guests",
    body: (
      <p>
        {n} does not collect payments from restaurant guests — restaurants take payment at the
        counter and record it in {n}. Guests should contact the restaurant directly for any refund of
        a meal or bill.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions about billing, cancellation or refunds: {BRAND.supportEmail}. See also our{" "}
        <Link href="/legal/terms">terms of service</Link>.
      </p>
    ),
  },
];

export function RefundPolicy() {
  return (
    <LegalDocument
      title="Cancellation & refund policy"
      currentHref="/legal/refunds"
      summary={
        <p>
          Subscriptions are activated manually and never renew automatically. Here is how cancelling
          and refunds work.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
