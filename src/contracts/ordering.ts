import type { BranchMenu } from "@/contracts/menu";
import type { GuestBillDto } from "@/contracts/billing";
import type { GuestOrderDto } from "@/contracts/orders";
import type { OrderStatus } from "@/domain/orders/order-status";
import type { SessionStatus } from "@/domain/tables/table-status";

/**
 * Customer (QR) ordering contract: what a guest's phone receives from the
 * public endpoints. Request bodies reuse `placeOrderSchema` from orders.ts.
 *
 * Guest visibility rules (enforced on the server, mirrored here by shape):
 * - a guest sees only THEIR OWN orders (full lines + status timeline);
 * - the table session status (open / bill requested / billed / closed);
 * - the table's bill summary once a bill is issued (no staff names, no
 *   payment references or methods);
 * - never another guest's orders, staff identities or any personal data.
 */

export interface PublicBrandingDto {
  restaurantName: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  /** Hex colour (e.g. "#e4572e") or null for the default theme. */
  brandColor: string | null;
  welcomeMessage: string | null;
  showPrepTime: boolean;
  showAllergens: boolean;
}

/** GET /public/qr/:token */
export interface PublicQrDto {
  branding: PublicBrandingDto;
  branch: { name: string };
  table: { name: string };
  currency: string;
  allowBillRequest: boolean;
  /** A non-closed session already exists for this table. */
  hasOpenSession: boolean;
  /** Branch-effective menu, available items only. */
  menu: BranchMenu;
}

/** POST /public/qr/:token/session */
export interface JoinSessionDto {
  sessionId: string;
  status: SessionStatus;
  /** true when this device already belonged to the session (cookie reused). */
  rejoined: boolean;
}

export interface GuestOrderStepDto {
  status: OrderStatus;
  at: string;
}

/** A guest's own order plus its status timestamps (no actor names). */
export interface GuestOrderViewDto extends GuestOrderDto {
  timeline: GuestOrderStepDto[];
}

/** GET /public/session */
export interface GuestSessionDto {
  session: {
    id: string;
    status: SessionStatus;
    openedAt: string;
    billRequestedAt: string | null;
  };
  restaurantName: string;
  branchName: string;
  tableName: string;
  currency: string;
  acceptingOrders: boolean;
  allowBillRequest: boolean;
  /** New orders can be placed right now. */
  canOrder: boolean;
  /** The bill-request button should be offered right now. */
  canRequestBill: boolean;
  orders: GuestOrderViewDto[];
  /** Present once staff have issued a bill for the table. */
  bill: GuestBillDto | null;
}

/** POST /public/session/orders → GuestOrderViewDto (201 new, 200 idempotent replay). */
export type PlaceGuestOrderResultDto = GuestOrderViewDto;

/** POST /public/session/bill-request */
export interface BillRequestResultDto {
  status: SessionStatus;
  billRequestedAt: string | null;
  /** true when the bill had already been requested (idempotent). */
  alreadyRequested: boolean;
}
