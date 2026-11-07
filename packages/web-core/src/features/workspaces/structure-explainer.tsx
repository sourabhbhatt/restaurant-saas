"use client";

import { AboutPanel } from "@ros/ui/shared/feedback";
import type { Entitlements } from "@ros/domain/subscriptions/entitlements";

import { PlanLimitsLine } from "../subscriptions/limit-notice";

/**
 * What a workspace, restaurant and branch are, in plain words, with this
 * plan's numbers. Hideable; a small "About …" button brings it back.
 */
export function StructureExplainer({
  entitlements,
  storageKey,
  title = "About workspaces, restaurants and branches",
}: {
  entitlements: Entitlements | undefined;
  /** Remembers per page whether the user hid it. */
  storageKey: string;
  title?: string;
}) {
  return (
    <AboutPanel storageKey={storageKey} title={title}>
      <p>
        <strong>Workspace</strong> is your business account: team members, roles, billing and plan
        limits live here. On a trial or monthly plan an organization has one workspace.
      </p>
      <p>
        <strong>Restaurant</strong> is a brand or concept with its own menu and branding.{" "}
        <strong>Branch</strong> is a physical location of a restaurant with its own tables, staff,
        settings, orders and bills.
      </p>
      {entitlements ? <PlanLimitsLine entitlements={entitlements} /> : null}
    </AboutPanel>
  );
}
