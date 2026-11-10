import { BRAND } from "../brand";

/**
 * Every indexable page of the public site, in sitemap order. Titles,
 * descriptions, canonical URLs, breadcrumbs, the sitemap, llms.txt and the
 * X-Robots-Tag allow-list all come from this list, so a page is either fully
 * set up for search or not public at all.
 */
export interface SitePage {
  path: string;
  /** `<title>` text. Child pages get the " · RestaurantOS" suffix from the root template. */
  title: string;
  /** The homepage title ignores the template. */
  absoluteTitle?: boolean;
  /** Meta description: what the page answers, about 150–160 characters. */
  description: string;
  /** Short label for breadcrumbs and link lists. */
  label: string;
  /** Path of the parent page in the breadcrumb trail (the homepage when omitted). */
  parent?: string;
}

const n = BRAND.name;

export const SITE_PAGES = [
  {
    path: "/",
    title: `Restaurant management software with QR ordering · ${n}`,
    absoluteTitle: true,
    description:
      "Restaurant management software for dine-in restaurants in India: QR table ordering, waiter approval, kitchen display, counter billing and multi-branch control.",
    label: "Home",
  },
  {
    path: "/features",
    title: "Restaurant software features",
    description:
      "QR table ordering, waiter approval, kitchen display, billing with split payments, menus, staff roles, multiple branches and offline-ready staff devices.",
    label: "Features",
  },
  {
    path: "/features/qr-code-ordering",
    title: "QR code ordering system for restaurants",
    description:
      "Guests scan the table's QR code and order from a live digital menu in the browser, with no app or account. A waiter approves every order before the kitchen sees it.",
    label: "QR code ordering",
    parent: "/features",
  },
  {
    path: "/features/kitchen-display-system",
    title: "Kitchen display system (KDS) for restaurants",
    description:
      "A browser-based kitchen display: approved orders appear live, cooks mark items preparing and ready, and late or rush orders stand out. Runs on any tablet.",
    label: "Kitchen display system",
    parent: "/features",
  },
  {
    path: "/features/restaurant-billing",
    title: "Restaurant billing software with split payments",
    description:
      "Generate a table's bill with branch taxes such as CGST and SGST, service charge and discounts, then record cash, UPI and card payments, split or partial.",
    label: "Restaurant billing",
    parent: "/features",
  },
  {
    path: "/features/offline-mode",
    title: "Offline-ready restaurant software",
    description:
      "What keeps working on RestaurantOS staff devices when the internet drops (saved menus, queued kitchen updates and waiter orders) and what needs a connection.",
    label: "Offline mode",
    parent: "/features",
  },
  {
    path: "/pricing",
    title: "Restaurant software pricing",
    description:
      "Monthly and annual plans for one outlet or a restaurant group, with a free trial and no card to start. Compare branch, staff, table and menu item limits.",
    label: "Pricing",
  },
  {
    path: "/faq",
    title: "FAQ: QR ordering, offline use and billing",
    description:
      "Straight answers about RestaurantOS: QR ordering without an app, waiter approval, offline use, payments, the free trial, your data and what isn't supported yet.",
    label: "FAQ",
  },
  {
    path: "/contact",
    title: "Contact sales and support",
    description:
      "Email the RestaurantOS team about plans, onboarding, custom pricing for restaurant groups, billing questions or privacy requests.",
    label: "Contact",
  },
  {
    path: "/legal/privacy",
    title: "Privacy policy",
    description:
      "How RestaurantOS collects, uses, shares, retains and deletes the personal data of restaurant owners, staff and guests who order by QR code.",
    label: "Privacy policy",
  },
  {
    path: "/legal/terms",
    title: "Terms of service",
    description:
      "The terms for using RestaurantOS: accounts, subscriptions and fees, acceptable use, your data, availability and liability.",
    label: "Terms of service",
  },
  {
    path: "/legal/refunds",
    title: "Cancellation and refund policy",
    description:
      "How cancelling a RestaurantOS subscription works, when refunds apply and how they are paid.",
    label: "Cancellation and refunds",
  },
] as const satisfies readonly SitePage[];

export type SitePath = (typeof SITE_PAGES)[number]["path"];

const BY_PATH = new Map<string, SitePage>(SITE_PAGES.map((p) => [p.path, p]));

/** The full `<title>` as rendered (root layout template: "%s · RestaurantOS"). */
export function fullTitle(page: SitePage): string {
  return page.absoluteTitle ? page.title : `${page.title} · ${n}`;
}

export function getSitePage(path: SitePath): SitePage {
  return BY_PATH.get(path)!;
}

/** Normalises a request pathname ("/pricing/" → "/pricing") and checks the allow-list. */
export function isPublicSitePath(pathname: string): boolean {
  const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return BY_PATH.has(normalised);
}

/** Home → … → page, for visible breadcrumbs and BreadcrumbList. */
export function breadcrumbTrail(path: SitePath): SitePage[] {
  const trail: SitePage[] = [];
  let current: SitePage | undefined = BY_PATH.get(path);
  while (current) {
    trail.unshift(current);
    if (current.path === "/") break;
    current = BY_PATH.get(current.parent ?? "/");
  }
  return trail;
}
