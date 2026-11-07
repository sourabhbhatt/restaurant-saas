/** Who is making the request, resolved on the server from the session cookie. */
export interface UserActor {
  type: "user";
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  emailVerified: boolean;
  activeWorkspaceId: string | null;
}

export interface RequestMeta {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditActor {
  type: "USER" | "GUEST" | "SYSTEM" | "PLATFORM_ADMIN";
  userId: string | null;
  ip?: string | null;
  requestId?: string | null;
}

export function auditActorFor(actor: UserActor, meta?: RequestMeta): AuditActor {
  return {
    type: "USER",
    userId: actor.userId,
    ip: meta?.ip ?? null,
    requestId: meta?.requestId ?? null,
  };
}
