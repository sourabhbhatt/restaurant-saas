/**
 * Identity port: credential verification and session tokens. The built-in
 * "local" adapter stores users/sessions in our own database. A hosted
 * provider (Clerk, Auth0, Supabase Auth, Better Auth) would implement the same
 * contract and map its subject id to our `users.id`; authorization, workspaces
 * and roles never depend on the identity provider.
 */
export interface SessionMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface IssuedSession {
  /** Opaque token for the session cookie. Only its hash is stored. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  expiresAt: Date;
  activeWorkspaceId: string | null;
}

export interface IdentityProvider {
  readonly name: string;
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, stored: string): Promise<boolean>;
  issueSession(userId: string, meta: SessionMeta): Promise<IssuedSession>;
  resolveSession(token: string): Promise<ResolvedSession | null>;
  revokeSession(token: string): Promise<void>;
  revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void>;
  setActiveWorkspace(sessionId: string, workspaceId: string | null): Promise<void>;
}
