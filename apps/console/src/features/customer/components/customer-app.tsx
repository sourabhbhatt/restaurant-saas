"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  ClipboardListIcon,
  QrCodeIcon,
  ReceiptIcon,
  ShoppingBagIcon,
  UtensilsCrossedIcon,
  WifiOffIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";

import type { BranchMenuItem } from "@ros/contracts/menu";
import type { GuestOrderViewDto } from "@ros/contracts/ordering";
import { effectiveItemPrice } from "@ros/domain/menu/pricing";
import { formatMoney } from "@ros/domain/shared/money";
import { Button } from "@ros/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ros/ui/ui/dialog";
import { Skeleton } from "@ros/ui/ui/skeleton";
import { ErrorState } from "@ros/ui/shared/feedback/error-state";
import { ApiError, errorMessage } from "@ros/api-client";
import { cn } from "@ros/ui/utils";

import { brandStyle } from "../brand";
import { cartTotals, useCartStore } from "../cart-store";
import { useGuestSession, useJoinedSessionId, useQrMenu } from "../queries";
import { MenuView } from "./menu-view";

/*
 * Only the menu is on screen when a guest scans the QR code. The sheets and the
 * other tabs (with their form controls and the menu contract's labels, which
 * pull in zod) are separate chunks, prefetched once the menu has rendered.
 */
const loadItemSheet = () => import("./item-sheet");
const loadCartSheet = () => import("./cart-sheet");
const loadOrdersView = () => import("./orders-view");
const loadBillView = () => import("./bill-view");
const ItemSheet = dynamic(() => loadItemSheet().then((m) => m.ItemSheet), { ssr: false });
const CartSheet = dynamic(() => loadCartSheet().then((m) => m.CartSheet), { ssr: false });
const OrdersView = dynamic(() => loadOrdersView().then((m) => m.OrdersView), { ssr: false });
const BillView = dynamic(() => loadBillView().then((m) => m.BillView), { ssr: false });

type Tab = "menu" | "orders" | "bill";

/** Customer QR ordering app for one table (route /t/[token]). */
export function CustomerApp() {
  const { token } = useParams<{ token: string }>();
  const menu = useQrMenu(token);
  const hydrate = useCartStore((s) => s.hydrate);
  const lines = useCartStore((s) => s.lines);
  const addLine = useCartStore((s) => s.add);
  const joined = useJoinedSessionId(token);
  const sessionQuery = useGuestSession(token, joined.loaded && joined.sessionId !== null);
  const [tab, setTab] = useState<Tab>("menu");
  const [item, setItem] = useState<BranchMenuItem | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [placed, setPlaced] = useState<GuestOrderViewDto | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    void hydrate(token);
  }, [hydrate, token]);

  // Warm the lazily loaded sheets and tabs as soon as the menu is on screen.
  const menuReady = menu.isSuccess;
  useEffect(() => {
    if (!menuReady) return;
    for (const load of [loadItemSheet, loadCartSheet, loadOrdersView, loadBillView]) void load();
  }, [menuReady]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Apply the restaurant's brand colour to portalled sheets/dialogs too.
  const brandColor = menu.data?.branding.brandColor ?? null;
  const brand = useMemo(() => brandStyle(brandColor), [brandColor]);
  useEffect(() => {
    if (!brand) return;
    const body = document.body.style;
    const entries = Object.entries(brand) as [string, string][];
    for (const [k, v] of entries) body.setProperty(k, v);
    return () => {
      for (const [k] of entries) body.removeProperty(k);
    };
  }, [brand]);

  // The session data is only "ours" if it is the session joined from this QR.
  const session =
    sessionQuery.data && sessionQuery.data.session.id === joined.sessionId
      ? sessionQuery.data
      : undefined;
  const sessionLost = sessionQuery.error instanceof ApiError && sessionQuery.error.status === 401;
  const isJoined = joined.sessionId !== null && !sessionLost && (!sessionQuery.data || !!session);

  if (menu.isPending) return <CustomerSkeleton />;
  if (menu.isError) {
    const err = menu.error;
    if (err instanceof ApiError && err.code === "QR_INVALID") {
      return <InvalidQr message={err.message} onRetry={() => void menu.refetch()} />;
    }
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center p-6">
        <ErrorState
          title={
            err instanceof ApiError && err.isNetworkError
              ? "You're offline"
              : "We couldn't load the menu"
          }
          message={
            err instanceof ApiError && err.isNetworkError
              ? "Connect to the internet to see the menu. Once loaded, it stays available offline."
              : errorMessage(err)
          }
          onRetry={() => void menu.refetch()}
          retrying={menu.isFetching}
        />
      </main>
    );
  }

  const data = menu.data;
  const { count, subtotal } = cartTotals(lines);
  const canOrder = session ? session.canOrder : true;
  const activeOrders =
    session?.orders.filter(
      (o) => !["SERVED", "COMPLETED", "REJECTED", "CANCELLED"].includes(o.status),
    ).length ?? 0;

  const openItem = (i: BranchMenuItem) => {
    setItem(i);
    setItemOpen(true);
  };
  const quickAdd = (i: BranchMenuItem) => {
    addLine({
      menuItemId: i.id,
      variantId: null,
      addonIds: [],
      quantity: 1,
      notes: "",
      name: i.name,
      variantName: null,
      addonNames: [],
      unitPrice: effectiveItemPrice(i),
      dietary: i.dietary,
      imageUrl: i.imageUrl,
    });
    toast.success(`${i.name} added`, { duration: 1500 });
  };

  return (
    <div
      style={{ ...brand, "--customer-header-h": "64px" } as CSSProperties}
      className="flex min-h-dvh flex-col bg-background"
    >
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {data.branding.logoUrl ? (
          <span className="relative size-10 shrink-0 overflow-hidden rounded-full border bg-muted">
            <Image
              src={data.branding.logoUrl}
              alt=""
              fill
              sizes="40px"
              className="object-cover"
              unoptimized
            />
          </span>
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <UtensilsCrossedIcon className="size-5" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base leading-tight font-semibold">
            {data.branding.restaurantName}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            Table {data.table.name} · {data.branch.name}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon-lg"
          className="relative size-11 rounded-full sm:size-11"
          onClick={() => setCartOpen(true)}
          aria-label={count > 0 ? `Open cart, ${count} items` : "Open cart"}
        >
          <ShoppingBagIcon className="size-5" />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground tabular-nums">
              {count}
            </span>
          )}
        </Button>
      </header>

      {(data.offline || !online) && (
        <div
          role="status"
          className="flex items-center gap-2 bg-warning/20 px-4 py-2 text-sm text-warning-foreground dark:text-warning"
        >
          <WifiOffIcon className="size-4 shrink-0" aria-hidden />
          {data.offline
            ? `Offline — showing saved menu${data.savedAt ? ` from ${new Date(data.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : ""}`
            : "You're offline. You can keep browsing; orders need a connection."}
        </div>
      )}

      <main className="mx-auto w-full max-w-3xl flex-1 pb-40">
        {tab === "menu" && (
          <MenuView
            categories={data.menu.categories}
            branding={data.branding}
            currency={data.currency}
            canOrder={canOrder}
            onOpenItem={openItem}
            onQuickAdd={quickAdd}
          />
        )}
        {tab === "orders" && (
          <OrdersView
            token={token}
            joined={isJoined}
            session={session}
            isPending={sessionQuery.isPending}
            isError={sessionQuery.isError && !sessionLost}
            error={sessionQuery.error}
            onRetry={() => void sessionQuery.refetch()}
            onBrowse={() => setTab("menu")}
            onShowBill={() => setTab("bill")}
          />
        )}
        {tab === "bill" && (
          <BillView
            joined={isJoined}
            session={session}
            isPending={sessionQuery.isPending}
            isError={sessionQuery.isError && !sessionLost}
            error={sessionQuery.error}
            onRetry={() => void sessionQuery.refetch()}
            onShowOrders={() => setTab("orders")}
          />
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)]">
        {tab === "menu" && count > 0 && (
          <div className="mx-auto max-w-3xl px-4 pb-2">
            <Button
              size="lg"
              className="h-14 w-full justify-between rounded-xl px-5 text-base shadow-lg sm:h-14"
              onClick={() => setCartOpen(true)}
            >
              <span className="inline-flex items-center gap-2">
                <ShoppingBagIcon className="size-5" aria-hidden />
                {count} item{count === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-2">
                View cart
                <span className="tabular-nums">{formatMoney(subtotal, data.currency)}</span>
              </span>
            </Button>
          </div>
        )}
        <nav
          aria-label="Customer sections"
          className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85"
        >
          <div className="mx-auto grid max-w-3xl grid-cols-3">
            <NavTab
              icon={<UtensilsCrossedIcon />}
              label="Menu"
              active={tab === "menu"}
              onClick={() => setTab("menu")}
            />
            <NavTab
              icon={<ClipboardListIcon />}
              label="My orders"
              active={tab === "orders"}
              badge={activeOrders}
              onClick={() => setTab("orders")}
            />
            <NavTab
              icon={<ReceiptIcon />}
              label="Bill"
              active={tab === "bill"}
              dot={Boolean(session?.bill)}
              onClick={() => setTab("bill")}
            />
          </div>
        </nav>
      </div>

      <ItemSheet
        item={item}
        open={itemOpen}
        onOpenChange={setItemOpen}
        currency={data.currency}
        showAllergens={data.branding.showAllergens}
        showPrepTime={data.branding.showPrepTime}
        canAdd={canOrder}
        onAdd={(line) => {
          addLine(line);
          toast.success(`${line.name} added`, { duration: 1500 });
        }}
      />
      <CartSheet
        open={cartOpen}
        onOpenChange={setCartOpen}
        token={token}
        currency={data.currency}
        canOrder={canOrder}
        onJoined={joined.setSessionId}
        onMenuOutdated={() => void menu.refetch()}
        onPlaced={(order) => {
          setCartOpen(false);
          setPlaced(order);
          setTab("orders");
        }}
      />

      <Dialog open={placed !== null} onOpenChange={(o) => !o && setPlaced(null)}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader className="items-center text-center">
            <span className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
              <ClipboardListIcon className="size-7" aria-hidden />
            </span>
            <DialogTitle>Order #{placed?.orderNumber} sent!</DialogTitle>
            <DialogDescription>
              The restaurant will confirm it shortly. You can follow its progress in My orders.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              size="lg"
              className="h-12 w-full"
              onClick={() => {
                setPlaced(null);
                setTab("orders");
              }}
            >
              Track my order
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 w-full"
              onClick={() => {
                setPlaced(null);
                setTab("menu");
              }}
            >
              Add more items
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NavTab({
  icon,
  label,
  active,
  onClick,
  badge = 0,
  dot = false,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset [&_svg]:size-5",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="relative">
        {icon}
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-2.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground tabular-nums">
            {badge}
            <span className="sr-only"> active</span>
          </span>
        )}
        {dot && badge === 0 && (
          <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-primary">
            <span className="sr-only">new</span>
          </span>
        )}
      </span>
      {label}
    </button>
  );
}

function CustomerSkeleton() {
  return (
    <div className="min-h-dvh" aria-busy="true" aria-label="Loading the menu">
      <div className="flex h-16 items-center gap-3 border-b px-4">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="space-y-4 p-4">
        <Skeleton className="h-11 w-full rounded-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20 rounded-full" />
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-full" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 py-2">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-4/5" />
            </div>
            <Skeleton className="size-28 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

function InvalidQr({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <QrCodeIcon className="size-8" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">This QR code isn&apos;t working</h1>
      <p className="max-w-sm text-muted-foreground">{message}</p>
      <ul className="max-w-sm space-y-1 text-left text-sm text-muted-foreground">
        <li>• Make sure you scanned the code on your table.</li>
        <li>• The restaurant may have paused table ordering for now.</li>
        <li>• A member of staff can take your order directly.</li>
      </ul>
      <Button variant="outline" size="lg" onClick={onRetry}>
        Try again
      </Button>
    </main>
  );
}
