"use client";

import Link from "next/link";
import {
  BellIcon,
  ChefHatIcon,
  CircleCheckIcon,
  CreditCardIcon,
  MegaphoneIcon,
  ReceiptTextIcon,
  SparklesIcon,
  UserPlusIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { Button } from "@/components/ui/button";
import type { NotificationDto, NotificationType } from "@ros/contracts/notifications";
import { absoluteTime, relativeTime } from "@/features/offline/format-time";
import { cn } from "@/lib/utils";

import { notificationHref } from "./deep-links";

const ICONS: Partial<Record<NotificationType, ComponentType<SVGProps<SVGSVGElement>>>> = {
  "order.created": ReceiptTextIcon,
  "order.accepted": CircleCheckIcon,
  "order.rejected": XCircleIcon,
  "order.ready": ChefHatIcon,
  "bill.requested": ReceiptTextIcon,
  "payment.recorded": CreditCardIcon,
  "staff.invited": UserPlusIcon,
  "trial.reminder": SparklesIcon,
  "trial.expired": SparklesIcon,
  "subscription.activated": SparklesIcon,
  "subscription.upgrade_rejected": SparklesIcon,
  "subscription.expired": SparklesIcon,
  "platform.announcement": MegaphoneIcon,
};

export interface NotificationItemProps {
  notification: NotificationDto;
  onMarkRead: (id: string) => void;
  /** Called after the user follows the notification's link (e.g. close a popover). */
  onNavigate?: () => void;
  dense?: boolean;
}

export function NotificationItem({
  notification: n,
  onMarkRead,
  onNavigate,
  dense = false,
}: NotificationItemProps) {
  const Icon = ICONS[n.type] ?? BellIcon;
  const href = notificationHref(n);
  const unread = !n.readAt;

  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
          unread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-sm break-words", unread ? "font-semibold" : "font-medium")}>
          {unread && <span className="sr-only">Unread: </span>}
          {n.title}
        </span>
        {n.body && (
          <span
            className={cn("text-sm break-words text-muted-foreground", dense && "line-clamp-2")}
          >
            {n.body}
          </span>
        )}
        <time
          className="text-xs text-muted-foreground"
          dateTime={n.createdAt}
          title={absoluteTime(n.createdAt)}
        >
          {relativeTime(n.createdAt)}
        </time>
      </span>
    </>
  );

  return (
    <li className={cn("group relative flex items-start gap-2", unread && "bg-primary/[0.03]")}>
      {href ? (
        <Link
          href={href}
          onClick={() => {
            if (unread) onMarkRead(n.id);
            onNavigate?.();
          }}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md p-3 outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {content}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-3 p-3">{content}</div>
      )}
      {unread && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="mt-2 mr-2 shrink-0 text-muted-foreground"
          onClick={() => onMarkRead(n.id)}
          aria-label={`Mark “${n.title}” as read`}
          title="Mark as read"
        >
          <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
        </Button>
      )}
    </li>
  );
}
