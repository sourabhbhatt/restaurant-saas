import { BRAND } from "../brand";
import { ALL_FAQ_ITEMS } from "../faq-data";
import { NOT_YET } from "../not-yet";
import { absoluteUrl, type SiteConfig } from "./site-config";
import { SITE_PAGES } from "./site-pages";

/**
 * /llms.txt (llmstxt.org proposal): a plain Markdown summary for AI agents.
 * It is NOT a ranking factor and Google Search does not use it; it is cheap,
 * generated from the same page list and FAQ as the site so it cannot drift.
 */
export function buildLlmsTxt(config: SiteConfig): string {
  const link = (path: string, label: string, note: string) =>
    `- [${label}](${absoluteUrl(config, path)}): ${note}`;
  const core = SITE_PAGES.filter((p) => !p.path.startsWith("/legal/"));
  const legal = SITE_PAGES.filter((p) => p.path.startsWith("/legal/"));
  const faq = ALL_FAQ_ITEMS.filter((i) =>
    ["no-app", "approval", "offline", "online-payments", "trial", "multi-branch"].includes(i.id),
  );

  return [
    `# ${BRAND.name}`,
    "",
    `> ${BRAND.description}`,
    "",
    `${BRAND.name} is a web app (installable as a PWA) for dine-in restaurants in India. Guests order by scanning a table QR code in the browser; a waiter approves each guest order; approved orders appear on a kitchen display; the counter generates the bill and records cash, UPI and card payments. One workspace can hold several restaurants and branches.`,
    "",
    "Not available yet: " + NOT_YET.map((n) => `${n.title.toLowerCase()} (${n.body})`).join("; "),
    "",
    "## Pages",
    "",
    ...core.map((p) => link(p.path, p.label, p.description)),
    "",
    "## Common questions",
    "",
    ...faq.map((i) => `- ${i.question} ${i.answer.join(" ")}`),
    "",
    "## Optional",
    "",
    ...legal.map((p) => link(p.path, p.label, p.description)),
    "",
  ].join("\n");
}
