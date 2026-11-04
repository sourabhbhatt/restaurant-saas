import {
  ArrowUpCircle,
  BarChart3,
  Building2,
  ChefHat,
  ClipboardList,
  CreditCard,
  Gauge,
  LayoutGrid,
  LifeBuoy,
  QrCode,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Store,
  UtensilsCrossed,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of navigation for the workspace and branch shells. Items
 * are shown when the user holds `permission` (display only — the API
 * enforces access). Feature modules own the pages these links point to.
 */
export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: string;
  /** Match nested routes as active. */
  exact?: boolean;
}

export function workspaceNav(workspaceId: string): NavItem[] {
  const base = `/app/w/${workspaceId}`;
  return [
    { label: "Overview", href: base, icon: Gauge, exact: true },
    {
      label: "Restaurants",
      href: `${base}/restaurants`,
      icon: Store,
      permission: "workspace.view",
    },
    {
      label: "Members",
      href: `${base}/members`,
      icon: Users,
      permission: "workspace.members.view",
    },
    {
      label: "Analytics",
      href: `${base}/analytics`,
      icon: BarChart3,
      permission: "workspace.analytics.view",
    },
    {
      label: "Subscription",
      href: `${base}/subscription`,
      icon: CreditCard,
      permission: "workspace.subscription.view",
    },
    {
      label: "Audit log",
      href: `${base}/audit`,
      icon: ScrollText,
      permission: "workspace.audit.view",
    },
    { label: "Support", href: `${base}/support`, icon: LifeBuoy, permission: "workspace.view" },
    { label: "Settings", href: `${base}/settings`, icon: Settings, permission: "workspace.update" },
  ];
}

export function branchNav(branchId: string): NavItem[] {
  const base = `/app/b/${branchId}`;
  return [
    { label: "Overview", href: base, icon: Gauge, exact: true },
    { label: "Menu", href: `${base}/menu`, icon: UtensilsCrossed, permission: "menu.view" },
    { label: "Tables & QR", href: `${base}/tables`, icon: QrCode, permission: "tables.view" },
    { label: "Orders", href: `${base}/orders`, icon: ClipboardList, permission: "orders.view" },
    { label: "Bills", href: `${base}/bills`, icon: Receipt, permission: "bills.view" },
    { label: "Staff", href: `${base}/staff`, icon: Users, permission: "staff.manage" },
    { label: "Reports", href: `${base}/reports`, icon: BarChart3, permission: "reports.view" },
    { label: "Settings", href: `${base}/settings`, icon: Settings, permission: "branch.update" },
  ];
}

/** Operational consoles (separate full-screen layouts). */
export function branchConsoles(branchId: string): NavItem[] {
  return [
    {
      label: "Waiter",
      href: `/waiter/${branchId}`,
      icon: LayoutGrid,
      permission: "orders.approve",
    },
    { label: "Kitchen", href: `/kitchen/${branchId}`, icon: ChefHat, permission: "kitchen.view" },
    { label: "Cashier", href: `/cashier/${branchId}`, icon: Wallet, permission: "payments.record" },
  ];
}

export function adminNav(): NavItem[] {
  return [
    { label: "Overview", href: "/admin", icon: Gauge, exact: true },
    { label: "Workspaces", href: "/admin/workspaces", icon: Building2 },
    { label: "Upgrade requests", href: "/admin/upgrade-requests", icon: ArrowUpCircle },
    { label: "Plans", href: "/admin/plans", icon: CreditCard },
    { label: "Support", href: "/admin/support", icon: LifeBuoy },
    { label: "Audit log", href: "/admin/audit", icon: ShieldCheck },
    { label: "Settings", href: "/admin/settings", icon: Settings },
  ];
}

/**
 * Permission required to open `pathname`: that of the nav item with the longest
 * matching href. Pages outside the nav inherit from their parent section. This
 * only decides what the UI shows; every API call is authorized on the server.
 */
export function requiredPermissionFor(pathname: string, nav: readonly NavItem[]): string | null {
  let best: NavItem | null = null;
  for (const item of nav) {
    const matches = item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.permission ?? null;
}
