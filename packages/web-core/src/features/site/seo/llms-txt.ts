import { BRAND } from "../brand";
import { ALL_FAQ_ITEMS } from "../faq-data";
import { NOT_YET } from "../not-yet";
import { formatPlanPrice, type PublicPlan, type PublicPlans } from "../pricing/plan-model";
import { absoluteUrl, type SiteConfig } from "./site-config";
import { SITE_PAGES } from "./site-pages";

/** One plain-text line per plan, with the same prices as the pricing cards. */
function planLine(plan: PublicPlan): string {
  const monthly = plan.monthlyPrice != null && formatPlanPrice(plan.monthlyPrice, plan.currency);
  const annual = plan.annualPrice != null && formatPlanPrice(plan.annualPrice, plan.currency);
  if (monthly && annual) return `- ${plan.name}: ${monthly}/month or ${annual}/year`;
  if (monthly) return `- ${plan.name}: ${monthly}/month`;
  if (annual) return `- ${plan.name}: ${annual}/year`;
  return `- ${plan.name}: custom pricing (contact us)`;
}

/** Live prices when the plans loaded; otherwise only a pointer to the pricing page. */
function pricingSection(config: SiteConfig, plans: PublicPlans | null): string[] {
  const page = absoluteUrl(config, "/pricing");
  if (!plans || plans.plans.length === 0) return [`Current plans and prices: ${page}`];
  return [
    ...plans.plans.map(planLine),
    "",
    `Prices exclude GST. New workspaces start with a free trial; no card is needed to start. Details: ${page}`,
  ];
}

/**
 * /llms.txt (llmstxt.org proposal): a plain Markdown summary for AI agents.
 * It is NOT a ranking factor and Google Search does not use it; it is cheap,
 * generated from the same page list, FAQ and plan data as the site so it
 * cannot drift. `plans` is null when the API is unavailable.
 */
export function buildLlmsTxt(config: SiteConfig, plans: PublicPlans | null = null): string {
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
    "## Pricing",
    "",
    ...pricingSection(config, plans),
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
