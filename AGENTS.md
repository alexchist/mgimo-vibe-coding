# Orbita development

Use the existing checkout. Cloud tasks are isolated; do not create Git worktrees unless requested.

This is a competition concept, not an official university service. All people, grades, messages and identifiers are fictional. Never use the university logo, real accounts or external student systems.

Stack: React + Vite frontend, Node 24 + Express + built-in SQLite backend. Run npm ci, npm run build, npm test. Use npm run dev for development. Persistent runtime files belong in ignored data/ and never in Git.

Integration docs: read docs/FEATURES_CONTRACT.md and docs/INTEGRATIONS.md before changing campus, knowledge, channels, assistant or MCP. npm start and npm run dev load the optional .env; never prefix server credentials with VITE_. Keep external integrations optional and disabled without complete configuration. No deployment/hosting work is included in this iteration.

Security: authorize every private API on the server; scope each query to session user; hash passwords with scrypt; use HttpOnly sessions and CSRF checks on writes; never store authentication tokens in browser storage. Never include service credentials in source.

Shared demo accounts: visitors using the same public login share its uploads, actions and connections, and may revoke its tokens. Do not describe account-level isolation as personal privacy between those visitors. Only fictional/educational uploads without real personal data or secrets belong in this demo. Live Telegram/VK pairing is disabled by default and must use a one-time expiring code from an authenticated webhook and private conversation, never a browser-supplied recipient ID.

AI/MCP: no keys means a clearly labelled local helper. Yandex uses the configured model URI and a strict tool allowlist; documents and model output are untrusted data. Prepare/confirm operations share server services, bind owner and actor, expire and resist repeated execution. No AI/MCP payment tool. The MCP HTTP endpoint uses scoped expiring Bearer tokens, not OAuth; store hashes only, disclose secrets once, validate Origin/Host, and recheck scope/revocation. The stdio bridge takes ORBITA_MCP_URL/TOKEN from the local client's environment.

Campus/payments/channels: check overlapping bookings in a transaction. Local demo payments collect no card data; YooKassa adapter is test-shop-only and must verify server-side test marker, amount, currency and ownership. Browser return is never proof of payment. Persist outbox and idempotency state. Delivery accepted by a provider is not a read receipt; ambiguous timeouts must not be reported as success or blindly resent.

Knowledge: shared fictional corpus plus account-owned TXT/MD/text-layer PDF uploads. Enforce size/time limits and owner checks on retrieval and deletion. Without an LLM, report search quotations rather than generated answers; with an LLM, preserve source attribution. No OCR is claimed.

Planner: academic items derive from existing deadlines; never edit them when marking personal preparation complete. Store per-user overrides separately. Personal task dates are null or within the clearly labelled demo week, 16–22 November 2026. Keep bootstrap.plan and GET /api/plan consistent; preserve existing databases.

Retries: retain the planner Idempotency-Key after a lost or malformed response; scope durable keys to the session user. Request archive preserves history and downloads and frees the unarchived quota. Keep coursework scores separate from assessment results; never infer a passed assessment from a high score. Preserve route context for request IDs, schedule days/week, session and planner items.

Quality: Russian UI, mobile from 360px, keyboard access, visible focus, form labels, helpful loading/error/empty states. No inert buttons or fictitious AI integrations. Demo behavior must be clearly labelled.

Record real prompts, decisions, tools, checks and limitations in docs. Do not invent user interviews, test results, deployment or AI services. Commit only on feat/orbita-student-portal, not main. Root agent owns integration, package files and Git commits.
