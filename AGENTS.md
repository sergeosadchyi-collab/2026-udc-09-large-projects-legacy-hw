# AGENTS.md

Baseline guidance for an Agentic IDE working in **this homework repo**.

> UDC Workshop 9 homework — an AI agent in an unfamiliar legacy codebase.
> Participants map the codebase and verify the map, find everything a small
> change actually touches, pin current behaviour with characterization tests,
> make the change without breaking anyone, and leave the knowledge behind for
> the next person. See `docs/walkthrough.md`.

## Context

- `app/` is an eight-year-old billing back office ("prykladpostach-billing"):
  customers, orders, invoices, payments, reminders, reports, exports.
  **Plain Node.js, CommonJS, callbacks, no npm dependencies, no build step.**
  - `cd app && npm test` runs the seeded suite (Node's built-in test runner).
  - `npm start` serves it on port 8080. Nothing in the homework needs a server.
- `app/docs/` is the legacy system's own documentation. **Some of it is out of
  date.** Treat every statement in it as a claim to check against the code.
- `materials/ticket-BILL-482.md` is the ticket you implement.
- Everything in `app/data/` is synthetic.

## Conventions

- Documentation language: Ukrainian or English (participant's choice).
- Deliverable paths so auto-review can find them:
  - `docs/codebase-map.md` (Task A)
  - `docs/impact.md` + characterization tests in `app/test/` (Task B)
  - the change itself in `app/lib/` (Task C)
  - `docs/ai-on-legacy.md` and `app/AGENTS.md` (Task D)
  - `docs/task-e-bonus.md` (Task E, bonus)
- Templates for every document are in `docs/templates/`.

## Guardrails

- **Change only what the ticket needs.** This is legacy code: do not convert it
  to ESM or async/await, do not rename things for taste, do not "clean up" code
  you were not asked to touch. A small diff is part of the grade.
- **Pin behaviour before you change it.** Characterization tests go in first,
  green on the unchanged code, then the change.
- **Do not edit `app/data/*.json`** — the fixtures are shared by the tests.
- Do not add npm dependencies to `app/`. If a bonus task needs a tool, run it
  with `npx` and say so in the PR.
- **NEVER** commit secrets, `.env`, or anything under `app/out/`.
- **Windows + Git Bash:** never use `2>nul` / `>nul` (creates a literal `nul`
  file). Use `2>/dev/null`.

## How to verify

`cd app && npm test` is green, including your characterization tests — and you
can say, for every expectation you changed, why that output was *meant* to
change.
