import { BRAND } from "./brand";

export interface FaqItem {
  id: string;
  question: string;
  answer: string[];
}

export interface FaqGroup {
  id: string;
  title: string;
  items: FaqItem[];
}

const n = BRAND.name;

export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: "ordering",
    title: "Ordering & guests",
    items: [
      {
        id: "no-app",
        question: "Do customers need to download an app or create an account?",
        answer: [
          "No. Guests scan the QR code on their table, browse the menu in their phone's browser and place an order. There is nothing to install and no account to create.",
          "Several guests at the same table can scan the same code and order together.",
        ],
      },
      {
        id: "approval",
        question: "Does the kitchen see an order as soon as a guest places it?",
        answer: [
          "No — by design. Every guest order first goes to a waiter, who approves it before it reaches the kitchen display. That stops mistaken or prank orders from being cooked.",
        ],
      },
      {
        id: "qr-security",
        question: "What if someone copies or photographs a table's QR code?",
        answer: [
          "Each table's QR code carries a secure token. You can regenerate or revoke it at any time from the dashboard, which immediately stops the old code from working. And because a waiter approves every order, a stray order never reaches the kitchen unchecked.",
        ],
      },
    ],
  },
  {
    id: "offline",
    title: "Offline & devices",
    items: [
      {
        id: "offline",
        question: "Does it work when the internet goes down?",
        answer: [
          `Partly, and we want to be clear about which part. ${n} is an installable web app (PWA). Screens and menus a staff device has already loaded keep working offline, waiters can keep adding orders for a table and the kitchen can keep updating tickets. Those changes are queued on the device and sent, in order, when the connection comes back.`,
          "Guest QR orders, approving guest orders, generating bills and recording payments need a live connection, so those buttons wait until you're back online.",
        ],
      },
      {
        id: "native-apps",
        question: "Is there an iOS or Android app?",
        answer: [
          `Not yet. ${n} runs in the browser on phones, tablets and computers, and you can install it to the home screen like an app. Native store apps aren't available today.`,
        ],
      },
      {
        id: "hardware",
        question:
          "Does it connect to POS hardware like receipt printers, cash drawers or card terminals?",
        answer: [
          "Not yet. There are no POS hardware integrations today. Cashiers record card and UPI payments taken on your existing terminal or QR, and table QR codes can be printed from the browser.",
        ],
      },
    ],
  },
  {
    id: "billing",
    title: "Billing & payments",
    items: [
      {
        id: "online-payments",
        question: "Can guests pay online from their phone?",
        answer: [
          "Not yet — there's no online payment gateway today. Bills are settled at the counter: cashiers record cash, UPI and card payments, including split and partial payments.",
        ],
      },
      {
        id: "bills",
        question: "Can bills include taxes, discounts and a service charge?",
        answer: [
          "Yes. Configure taxes and service charge per branch, apply discounts when generating a bill, and split or part-pay it across payment methods.",
        ],
      },
      {
        id: "delivery",
        question: "Do you support delivery or takeaway orders?",
        answer: [
          `Not yet. ${n} is built for dine-in table service today. Delivery and takeaway aren't supported.`,
        ],
      },
    ],
  },
  {
    id: "account",
    title: "Plans & your account",
    items: [
      {
        id: "trial",
        question: "How does the free trial work?",
        answer: [
          "Every new workspace starts with a free trial — 15 days by default. No card is needed to start. When you're ready to continue, choose a plan and we activate your subscription.",
        ],
      },
      {
        id: "after-expiry",
        question: "What happens to my data if my trial or subscription ends?",
        answer: [
          "Your data is kept — it is not deleted automatically. After a short grace period, access to the workspace is restricted until a plan is activated, and you can pick up exactly where you left off.",
          "If you want your data deleted, ask us and we'll remove it. See the privacy policy for retention details.",
        ],
      },
      {
        id: "multi-branch",
        question: "Can I run several restaurants and branches from one account?",
        answer: [
          "Yes. A workspace holds multiple restaurants, and each restaurant can have multiple branches with their own prices, item availability, tables and staff. Plan limits apply.",
        ],
      },
      {
        id: "roles",
        question: "Can I control what each staff member can do?",
        answer: [
          "Yes. Staff get roles — owner, admin, manager, waiter, kitchen or cashier — each with its own permissions, assigned for a whole restaurant or a single branch. Important changes are recorded in an audit log.",
        ],
      },
    ],
  },
];

/** A short selection for the landing page. */
export const FAQ_PREVIEW_IDS = ["no-app", "approval", "offline", "online-payments", "after-expiry"];

export const ALL_FAQ_ITEMS = FAQ_GROUPS.flatMap((g) => g.items);
