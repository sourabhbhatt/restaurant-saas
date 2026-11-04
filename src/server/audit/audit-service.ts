import type { AuditActor } from "../context";
import type { AuditRepository } from "../ports/core-repositories";

/**
 * Audit trail. Call inside the same transaction as the change it records, so
 * an audit row exists if and only if the change committed.
 * Metadata must be safe: ids, statuses, amounts — never passwords, tokens,
 * full addresses or payment secrets.
 */
export interface AuditTarget {
  workspaceId: string | null;
  branchId?: string | null;
  targetType?: string;
  targetId?: string;
}

export function recordAudit(
  repo: AuditRepository,
  actor: AuditActor,
  action: string,
  target: AuditTarget,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  return repo.insert({
    workspaceId: target.workspaceId,
    branchId: target.branchId ?? null,
    actorType: actor.type,
    actorUserId: actor.userId,
    action,
    targetType: target.targetType ?? null,
    targetId: target.targetId ?? null,
    metadata,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });
}
