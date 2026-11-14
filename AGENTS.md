# Orbita development

Use the existing checkout. Cloud tasks are isolated; do not create Git worktrees unless requested.

This is a competition concept, not an official university service. All people, grades, messages and identifiers are fictional. Never use the university logo, real accounts or external student systems.

Stack: React + Vite frontend, Node 24 + Express + built-in SQLite backend. Run npm ci, npm run build, npm test. Use npm run dev for development. Persistent runtime files belong in ignored data/ and never in Git.

Security: authorize every private API on the server; scope each query to session user; hash passwords with scrypt; use HttpOnly sessions and CSRF checks on writes; never store authentication tokens in browser storage. Never include service credentials in source.

Quality: Russian UI, mobile from 360px, keyboard access, visible focus, form labels, helpful loading/error/empty states. No inert buttons or fictitious AI integrations. Demo behavior must be clearly labelled.

Record real prompts, decisions, tools, checks and limitations in docs. Do not invent user interviews, test results, deployment or AI services. Commit only on feat/orbita-student-portal, not main. Root agent owns integration, package files and Git commits.
