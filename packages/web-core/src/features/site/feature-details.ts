import { BRAND } from "./brand";
import type { SitePath } from "./seo/site-pages";

/**
 * Content of the feature pages that answer one search intent each. Every
 * statement here describes what the code does today; limits are listed on
 * the page, not hidden. Update this file together with the feature.
 */
export interface FeatureDetail {
  path: SitePath;
  eyebrow: string;
  h1: string;
  /** First paragraph: the direct answer to the page's main question. */
  lead: string;
  /** "What is …?" in plain words, then how RestaurantOS does it. */
  definition: { question: string; answer: string[] };
  steps: { title: string; body: string }[];
  stepsTitle: string;
  details: { title: string; points: string[] }[];
  limits: { title: string; body: string }[];
  /** FAQ items (by id) shown on the page. */
  faqIds: string[];
  related: SitePath[];
}

const n = BRAND.name;

export const FEATURE_DETAILS: FeatureDetail[] = [
  {
    path: "/features/qr-code-ordering",
    eyebrow: "QR code ordering",
    h1: "QR code ordering for dine-in restaurants",
    lead: `Guests scan the QR code on their table and order from your live menu in their phone's browser. There is no app to install and no account to create, and in ${n} every guest order is checked by a waiter before the kitchen sees it.`,
    definition: {
      question: "What is a QR code ordering system?",
      answer: [
        "A QR code ordering system lets restaurant guests open the menu and place an order from their own phone by scanning a code on the table. Because each table has its own code, every order arrives already linked to the right table, so nobody has to write it down or key it in again.",
        `${n} adds one step most systems skip: a waiter approves each guest order. Mistaken, duplicate or prank orders are rejected with a reason instead of being cooked.`,
      ],
    },
    stepsTitle: "How QR ordering works in RestaurantOS",
    steps: [
      {
        title: "Create tables and print their codes",
        body: "Add tables with sections and seating capacity, then download each table's QR code as PNG or SVG, or print a sheet of codes from the browser.",
      },
      {
        title: "Guests scan and browse the menu",
        body: "The menu opens in the browser with photos, variants (sizes, portions), add-ons and veg/non-veg marks. It shows only what that branch sells, at that branch's prices, with allergens (a restaurant setting can hide them).",
      },
      {
        title: "The whole table orders together",
        body: "Everyone at the table can scan the same code and add their own items, with notes for the kitchen. The cart stays on the guest's phone if the page is reloaded.",
      },
      {
        title: "A waiter approves the order",
        body: "Guest orders wait in the waiter's live queue. Approved orders go straight to the kitchen display; rejected orders go back to the guest with the reason.",
      },
      {
        title: "Guests follow their order and ask for the bill",
        body: "Guests see the status of each order on their phone, can ask for the bill from the table, and see the bill once staff have prepared it.",
      },
    ],
    details: [
      {
        title: "A digital menu that is always current",
        points: [
          "One menu per restaurant, with branch-level prices and availability",
          "Mark an item, variant or add-on sold out and guests can no longer order it",
          "Featured items and discounted prices",
          "Set prep times and dietary tags once; the kitchen display uses the prep time",
        ],
      },
      {
        title: "Table codes you control",
        points: [
          "Each code carries a secure token, not a guessable table number",
          "Regenerating a code retires the old one immediately",
          "Revoke a table's code while the table is out of service",
          "Even with a valid code, nothing reaches the kitchen without a waiter",
        ],
      },
    ],
    limits: [
      {
        title: "No payment from the guest's phone",
        body: "There is no online payment gateway yet. Guests see their bill on the phone and pay at the counter.",
      },
      {
        title: "Dine-in only",
        body: "QR ordering is for guests seated at a table. Takeaway and delivery ordering are not supported.",
      },
      {
        title: "Ordering needs the guest to be online",
        body: "Opening the menu and placing an order need a connection on the guest's phone. If the connection drops while the menu is open, the guest keeps the cart and the menu already on screen.",
      },
    ],
    faqIds: ["no-app", "approval", "qr-security", "online-payments"],
    related: ["/features/kitchen-display-system", "/features/restaurant-billing", "/pricing"],
  },
  {
    path: "/features/kitchen-display-system",
    eyebrow: "Kitchen display system",
    h1: "A kitchen display system that runs in the browser",
    lead: `The ${n} kitchen display shows approved orders as live tickets on any tablet, laptop or TV with a modern browser. Cooks move orders and individual items through preparing and ready, and waiters see when food is ready to pick up.`,
    definition: {
      question: "What is a kitchen display system (KDS)?",
      answer: [
        "A kitchen display system replaces paper order tickets with a screen in the kitchen. Orders appear on the screen as soon as they are confirmed, cooks update their progress, and front-of-house staff can see it without walking to the pass.",
        `In ${n} the kitchen display is part of the same system as QR ordering, the waiter screens and billing, so there is no separate KDS to connect or keep in sync.`,
      ],
    },
    stepsTitle: "How the kitchen display works",
    steps: [
      {
        title: "Only confirmed orders arrive",
        body: "Guest orders appear once a waiter approves them. Orders entered by staff go straight to the kitchen.",
      },
      {
        title: "Tickets update live",
        body: "New tickets appear without refreshing the page, with an optional sound alert. If the live connection drops, the screen falls back to checking for new orders every few seconds until it reconnects.",
      },
      {
        title: "Progress per order and per item",
        body: "Start an order, mark single items preparing or ready, and mark the order ready for pickup. Waiters see ready orders on their own screen.",
      },
      {
        title: "Late and rush orders stand out",
        body: "A ticket is flagged as late once it runs past the dish's prep time or the branch's delay limit, whichever comes first. Staff can mark an order as rush.",
      },
    ],
    details: [
      {
        title: "Built for a busy pass",
        points: [
          "Dark and light themes, and a full-screen mode for wall-mounted screens",
          "Sort tickets by time or by priority",
          "Kitchen staff accounts see the kitchen screen, not the bills",
          "Each branch has its own kitchen feed",
        ],
      },
      {
        title: "Rides out Wi-Fi drops",
        points: [
          "Status changes made offline are saved on the device and marked “Waiting to sync”",
          "They are sent in order when the connection returns, never twice",
          "A queued change is never shown as done until the server confirms it",
          "If a change is refused (for example, the order was cancelled), the ticket says so",
        ],
      },
    ],
    limits: [
      {
        title: "No kitchen printer",
        body: "Tickets are not printed to thermal printers; there are no POS hardware integrations yet.",
      },
      {
        title: "One screen view per branch",
        body: "Orders are not split into separate stations (grill, bar, desserts). Every kitchen screen in a branch shows the same tickets.",
      },
    ],
    faqIds: ["approval", "offline", "hardware"],
    related: ["/features/qr-code-ordering", "/features/offline-mode", "/pricing"],
  },
  {
    path: "/features/restaurant-billing",
    eyebrow: "Restaurant billing",
    h1: "Restaurant billing with taxes, discounts and split payments",
    lead: `Generate a table's bill from the orders it actually received, with your branch's taxes and service charge applied automatically, then record how it was paid: cash, UPI, card or a mix. ${n} keeps the kitchen, the waiters and the counter on the same numbers.`,
    definition: {
      question: "What does restaurant billing software do?",
      answer: [
        "Restaurant billing software turns a table's orders into a bill. It adds up the items, applies discounts, service charge and taxes, and records the payments so the day's takings add up.",
        `In ${n} the bill is built on the server from the table's approved orders, at the prices that applied when each order was placed, so nobody re-enters items at the counter.`,
      ],
    },
    stepsTitle: "How billing works",
    steps: [
      {
        title: "Generate the bill for a table",
        body: "A waiter or cashier generates the bill when the table is ready to pay, or when the guest asks for it from their phone.",
      },
      {
        title: "Apply a discount if needed",
        body: "Percentage or flat discounts are applied at billing time, with an optional reason, and can never exceed the bill.",
      },
      {
        title: "Taxes and service charge come from the branch",
        body: "Each branch has its own named tax lines (for example CGST 2.5% and SGST 2.5%), a service charge rate, and a setting for whether menu prices include tax.",
      },
      {
        title: "Record the payment",
        body: "Record cash, UPI and card payments (and other methods the branch enables), split across methods or paid in parts. The balance due is worked out for you.",
      },
    ],
    details: [
      {
        title: "Exact, auditable numbers",
        points: [
          "Amounts are kept in whole paise, so there are no rounding drift errors",
          "The same orders and settings always produce the same bill",
          "Refunds and voids need a reason and are kept in the audit log",
          "Guests can see their bill on their phone once it is generated",
        ],
      },
      {
        title: "Reports",
        points: [
          "Sales and orders for any date range, per branch or across the business",
          "Branch comparison and advanced reports on plans that include them",
        ],
      },
    ],
    limits: [
      {
        title: "No online payment gateway",
        body: "Payments are taken on your existing UPI QR, card terminal or cash drawer and recorded in RestaurantOS.",
      },
      {
        title: "No POS hardware",
        body: "There is no direct connection to receipt printers, cash drawers or card terminals.",
      },
      {
        title: "Not accounting or tax filing software",
        body: "RestaurantOS does not file GST returns or generate e-invoices. Check with your accountant that your bill format meets the invoice rules that apply to you.",
      },
    ],
    faqIds: ["bills", "online-payments", "hardware"],
    related: ["/features/qr-code-ordering", "/features/kitchen-display-system", "/pricing"],
  },
  {
    path: "/features/offline-mode",
    eyebrow: "Offline mode",
    h1: "Offline-ready restaurant software: what works without internet",
    lead: `${n} staff screens are an installable web app that keeps working through connection drops. Screens you have loaded stay usable, waiter orders and kitchen updates are queued and sent later, and the steps that must reach the server are clearly blocked until you are back online.`,
    definition: {
      question: "Does RestaurantOS work without internet?",
      answer: [
        "Partly, by design. Each staff device keeps a copy of what it last loaded and a queue of changes that are safe to send later. Anything that confirms a guest's order or moves money needs the server, so those buttons are disabled while offline and say why.",
        `${n} is not a local-server POS that runs a whole restaurant without internet for days. It is built for patchy restaurant Wi-Fi and short outages, with the server always the single source of truth.`,
      ],
    },
    stepsTitle: "What keeps working offline",
    steps: [
      {
        title: "Screens and menus you have opened",
        body: "Staff screens, the kitchen feed, table sessions and the branch menu are saved on the device (for up to seven days) and shown with a note of how old the data is.",
      },
      {
        title: "Waiters can keep taking orders",
        body: "A waiter can add an order for a table from the last menu the device loaded. It is shown as “Not sent — will send when online” until the server accepts it, and prices always come from the server.",
      },
      {
        title: "The kitchen can keep cooking",
        body: "Starting orders and marking items or orders ready are queued on the kitchen screen and synced in order when the connection returns.",
      },
      {
        title: "Guests keep their cart",
        body: "A guest's cart is kept on their phone. If the connection drops while the menu is open, the menu stays on screen; reopening it and sending the order wait for the connection.",
      },
    ],
    details: [
      {
        title: "Needs a connection",
        points: [
          "Opening or reloading a guest's QR menu (guest pages are not saved for offline use)",
          "Guests placing QR orders",
          "Approving or rejecting guest orders",
          "Generating bills, recording payments, refunds and voids",
          "Closing a table",
        ],
      },
      {
        title: "How syncing stays safe",
        points: [
          "Queued changes are sent one after another, in the order they were made",
          "Each change carries an idempotency key, so a retry never creates a duplicate order",
          "A waiter order queued more than 10 minutes ago asks “Send it now?” before it goes",
          "If the table was closed or reopened meanwhile, the server refuses the old order",
          "Conflicts are shown with the server's message; nothing pending is silently discarded",
          "On a shared device, one person's unsent changes are never sent with another person's account",
        ],
      },
    ],
    limits: [
      {
        title: "No billing during a long outage",
        body: "Bills and payments need the server. If the internet is down for hours, record them on paper and enter them when you are back online.",
      },
      {
        title: "Devices don't sync with each other offline",
        body: "Each device has its own queue. Two devices only see each other's changes after both have synced with the server.",
      },
    ],
    faqIds: ["offline", "native-apps"],
    related: ["/features/kitchen-display-system", "/features/qr-code-ordering", "/faq"],
  },
];

export function getFeatureDetail(path: SitePath): FeatureDetail {
  const detail = FEATURE_DETAILS.find((d) => d.path === path);
  if (!detail) throw new Error(`No feature detail for ${path}`);
  return detail;
}
