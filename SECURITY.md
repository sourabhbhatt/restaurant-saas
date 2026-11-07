# Security

## Reporting a vulnerability

Email the maintainers privately (do not open a public issue) with steps to reproduce and the affected version or commit. We aim to acknowledge reports within 3 business days.

## Incident: session cookie jars committed to git

**What was exposed.** Two curl cookie-jar files, `n.jar` and `o.jar`, were committed to the public repository (branch `claude/epic-turing-vhor3y`, commit `586e3b4`). Each contained a local-development `ros_session` token.

**Reach.** The tokens are valid only against the local PGlite development database, never production. A session token is useless without access to that database.

**Remediation.**

1. Both files are removed from the git index and `*.jar` / `*.cookies` are git-ignored.
2. The sessions were revoked with `pnpm db:revoke-cookie-jar n.jar o.jar` (sets `revoked_at` on the matching sessions; the tool prints counts only, never token values).
3. No history rewrite is recommended. Rewriting a pushed public branch is destructive, and the tokens are already dead.

If you ever export a cookie jar, keep it outside the repository and revoke it with the command above.
