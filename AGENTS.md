# Sofra agent guide

Sofra is a Türkiye-first managed marketplace for scheduled dinners inside verified households. Read `docs/PRODUCT_CONSTITUTION.md` and `docs/DECISIONS.md` before changing product behavior.

- Decisions in `docs/DECISIONS.md` are authoritative. Never silently resolve items in `docs/OPEN_QUESTIONS.md` in code.
- Keep launch-policy defaults typed and configurable. Money is integer kuruş.
- Exact addresses, precise coordinates, dietary disclosures, assessment notes, and safety records are sensitive. They must never enter public projections, analytics, metadata, or client bundles.
- Do not introduce a real payment provider assumption. Local and test use the guarded mock provider; production without a provider must stop honestly.
- Keep this project a single Next.js modular monolith organized by product domain. Presentation components do not mutate the database or lifecycle status directly.
- SQL migrations in `db/migrations` are the schema source of truth. Authorization is enforced in the server layer, not by row-level security; administrative roles come from server-controlled assignments only.
- Preserve both shared and private tables, host-selected menus, meaningful host participation, and tea/conversation as central product principles. Do not add alcohol product features or guest appearance-selection features.
- Run formatting checks, lint, type checking, tests, and the production build for completed changes. Add focused tests for changed business rules.
- Never deploy, create remote resources, configure a remote, or expose credentials without explicit user instruction.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
