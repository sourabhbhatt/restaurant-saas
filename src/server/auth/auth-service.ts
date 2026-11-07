import { DomainError } from "@/domain/shared/errors";
import { generateToken, hashToken, isWellFormedToken } from "@/domain/shared/tokens";

import { recordAudit } from "../audit/audit-service";
import type { Container } from "../container";
import type { RequestMeta, UserActor } from "../context";
import { emailTemplates, sendEmail } from "../notifications/email";

const RESET_TTL_MS = 60 * 60_000;
const VERIFY_TTL_MS = 48 * 60 * 60_000;

type Deps = Pick<
  Container,
  "db" | "identity" | "repos" | "clock" | "env" | "email" | "logger" | "entitlements"
>;

const genericSignInError = () =>
  new DomainError("UNAUTHENTICATED", "Email or password is incorrect", {
    fieldErrors: { password: ["Email or password is incorrect"] },
  });

const normalizeEmail = (email: string) => email.trim().toLowerCase();

let dummyHash: Promise<string> | null = null;

export function createAuthService(c: Deps) {
  const users = c.repos.identity;
  // A real hash with production parameters, so unknown emails cost the same time.
  dummyHash ??= c.identity.hashPassword("timing-equalizer-not-a-password");
  const systemAudit = (meta: RequestMeta, userId: string | null) => ({
    type: "USER" as const,
    userId,
    ip: meta.ip,
    requestId: meta.requestId,
  });

  async function sendVerification(userId: string, email: string) {
    const token = generateToken();
    await users.createAuthToken({
      userId,
      purpose: "EMAIL_VERIFICATION",
      tokenHash: await hashToken(token),
      expiresAt: new Date(c.clock.now().getTime() + VERIFY_TTL_MS),
    });
    const url = `${c.env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
    await sendEmail(c, { to: email, ...emailTemplates.verifyEmail(c.env.APP_NAME, url) });
  }

  return {
    async signUp(input: { name: string; email: string; password: string }, meta: RequestMeta) {
      const settings = await c.entitlements.getPlatformSettings();
      if (!settings.signupsEnabled) {
        throw new DomainError("FORBIDDEN", "New sign-ups are temporarily disabled");
      }
      const existing = await users.findUserByEmail(input.email);
      if (existing) {
        throw new DomainError("CONFLICT", "An account with this email already exists", {
          fieldErrors: { email: ["An account with this email already exists. Sign in instead."] },
        });
      }
      const user = await users.createUser({
        email: input.email,
        name: input.name,
        passwordHash: await c.identity.hashPassword(input.password),
      });
      await recordAudit(c.repos.audit, systemAudit(meta, user.id), "auth.signup", {
        workspaceId: null,
        targetType: "user",
        targetId: user.id,
      });
      await sendVerification(user.id, user.email);
      const session = await c.identity.issueSession(user.id, {
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { user, session };
    },

    async signIn(input: { email: string; password: string }, meta: RequestMeta) {
      // Per-account bucket: rotating IPs must not allow unlimited guesses at one account.
      const attempt = await c.repos.rateLimit.hit(
        `signin-account:${normalizeEmail(input.email)}`,
        15 * 60_000,
        c.clock.now(),
      );
      if (attempt.count > 10) {
        throw new DomainError(
          "RATE_LIMITED",
          "Too many attempts. Please wait a moment and try again.",
          {
            details: {
              retryAfterSeconds: Math.ceil(
                (attempt.resetAt.getTime() - c.clock.now().getTime()) / 1000,
              ),
            },
          },
        );
      }
      const user = await users.findUserByEmail(input.email);
      // Always run a hash comparison so response time does not reveal whether the email exists.
      const ok = user?.passwordHash
        ? await c.identity.verifyPassword(input.password, user.passwordHash)
        : await c.identity.verifyPassword(input.password, await dummyHash!).then(() => false);
      if (!user || !ok) {
        await recordAudit(
          c.repos.audit,
          systemAudit(meta, user?.id ?? null),
          "auth.signin_failed",
          {
            workspaceId: null,
            targetType: "user",
            targetId: user?.id,
          },
        );
        throw genericSignInError();
      }
      if (user.disabledAt)
        throw new DomainError("FORBIDDEN", "This account is disabled. Contact support.");
      await users.updateUser(user.id, { lastLoginAt: c.clock.now() });
      const session = await c.identity.issueSession(user.id, {
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      await recordAudit(c.repos.audit, systemAudit(meta, user.id), "auth.signin", {
        workspaceId: null,
        targetType: "user",
        targetId: user.id,
      });
      return { user, session };
    },

    async signOut(token: string | null, actor: UserActor | null, meta: RequestMeta) {
      if (token) await c.identity.revokeSession(token);
      if (actor) {
        await recordAudit(c.repos.audit, systemAudit(meta, actor.userId), "auth.signout", {
          workspaceId: null,
          targetType: "user",
          targetId: actor.userId,
        });
      }
    },

    /** Always succeeds from the caller's view, to avoid account enumeration. */
    async requestPasswordReset(email: string, meta: RequestMeta) {
      // Over the limit we still report success so the response never reveals the account.
      const attempt = await c.repos.rateLimit.hit(
        `forgot-account:${normalizeEmail(email)}`,
        60 * 60_000,
        c.clock.now(),
      );
      if (attempt.count > 3) return;
      const user = await users.findUserByEmail(email);
      if (!user || user.disabledAt) return;
      const since = new Date(c.clock.now().getTime() - 60 * 60_000);
      if ((await users.countRecentAuthTokens(user.id, "PASSWORD_RESET", since)) >= 5) return;
      const token = generateToken();
      await users.createAuthToken({
        userId: user.id,
        purpose: "PASSWORD_RESET",
        tokenHash: await hashToken(token),
        expiresAt: new Date(c.clock.now().getTime() + RESET_TTL_MS),
      });
      const url = `${c.env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
      await sendEmail(c, { to: user.email, ...emailTemplates.resetPassword(c.env.APP_NAME, url) });
      await recordAudit(
        c.repos.audit,
        systemAudit(meta, user.id),
        "auth.password_reset_requested",
        {
          workspaceId: null,
          targetType: "user",
          targetId: user.id,
        },
      );
    },

    async resetPassword(token: string, password: string, meta: RequestMeta) {
      const invalid = () =>
        new DomainError("VALIDATION_FAILED", "This reset link is invalid or has expired", {
          fieldErrors: { token: ["This reset link is invalid or has expired. Request a new one."] },
        });
      if (!isWellFormedToken(token)) throw invalid();
      const consumed = await users.consumeAuthToken(
        await hashToken(token),
        "PASSWORD_RESET",
        c.clock.now(),
      );
      if (!consumed) throw invalid();
      await users.updateUser(consumed.userId, {
        passwordHash: await c.identity.hashPassword(password),
      });
      await users.invalidateAuthTokens(consumed.userId, "PASSWORD_RESET", c.clock.now());
      // A password reset signs out every existing session.
      await c.identity.revokeAllSessions(consumed.userId);
      await recordAudit(c.repos.audit, systemAudit(meta, consumed.userId), "auth.password_reset", {
        workspaceId: null,
        targetType: "user",
        targetId: consumed.userId,
      });
    },

    async verifyEmail(token: string, meta: RequestMeta) {
      const invalid = () =>
        new DomainError("VALIDATION_FAILED", "This verification link is invalid or has expired");
      if (!isWellFormedToken(token)) throw invalid();
      const consumed = await users.consumeAuthToken(
        await hashToken(token),
        "EMAIL_VERIFICATION",
        c.clock.now(),
      );
      if (!consumed) throw invalid();
      await users.updateUser(consumed.userId, { emailVerifiedAt: c.clock.now() });
      await recordAudit(c.repos.audit, systemAudit(meta, consumed.userId), "auth.email_verified", {
        workspaceId: null,
        targetType: "user",
        targetId: consumed.userId,
      });
    },

    async resendVerification(actor: UserActor) {
      if (actor.emailVerified) return;
      const since = new Date(c.clock.now().getTime() - 60 * 60_000);
      if ((await users.countRecentAuthTokens(actor.userId, "EMAIL_VERIFICATION", since)) >= 5) {
        throw new DomainError("RATE_LIMITED", "Too many verification emails. Try again later.");
      }
      await sendVerification(actor.userId, actor.email);
    },

    async changePassword(actor: UserActor, current: string, next: string, meta: RequestMeta) {
      const user = await users.findUserById(actor.userId);
      if (!user?.passwordHash || !(await c.identity.verifyPassword(current, user.passwordHash))) {
        throw new DomainError("VALIDATION_FAILED", "Current password is incorrect", {
          fieldErrors: { currentPassword: ["Current password is incorrect"] },
        });
      }
      await users.updateUser(actor.userId, { passwordHash: await c.identity.hashPassword(next) });
      await c.identity.revokeAllSessions(actor.userId, actor.sessionId);
      await recordAudit(c.repos.audit, systemAudit(meta, actor.userId), "auth.password_changed", {
        workspaceId: null,
        targetType: "user",
        targetId: actor.userId,
      });
    },
  };
}
