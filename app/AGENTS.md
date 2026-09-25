# AGENTS.md — prykladpostach-billing

Read this before you touch anything. It is the knowledge that is **not** in the
code and that the code will not warn you about.

## The one rule

> Before you change **anything** that formats a date or an amount, check what
> happens to `out/export/oblik-*.csv`.

## `lib/format.js` — two date formatters, and they are not interchangeable

| Function | Format | For whom | May it change? |
|---|---|---|---|
| `formatDate()` | `MM/DD/YYYY` | **«Облік-Плюс»** (accounting system) | **NO.** Contract. |
| `formatDateUk()` | `DD.MM.YYYY` | customers — invoice HTML, reminder mails | yes, this is the human-facing one |

`formatDate` is **not** a "display" helper, whatever its name suggests. It is
the wire format of an integration. Do not change it, do not rename it, do not
"unify" the two.

### Why renaming it breaks things silently

`lib/export/accounting.js:30` does not call it by name:

```js
var render = format['format' + col.type];   // col.type = "Date" from config/export-columns.json
```

Consequences:

- **`grep formatDate` does NOT find the export.** Searching by function name
  finds 2 of the 3 consumers and looks complete, because those 2 are exactly
  the ones a ticket would mention. Search by module import instead:
  `grep -rn "require(.*format" lib bin` → 3 files.
- Renaming `formatDate` turns the lookup into `undefined` and the export throws
  `unknown column type "Date"`.
- Changing what it **returns** is worse than throwing: see below.

### The failure is silent, and it has happened

«Облік-Плюс» does not reject a row with an unexpected date format — it
**skips** it and logs a warning on their side that nobody reads. No error here,
no mail from them. February 2021: 40 invoices never reached accounting, tests
were green, found three weeks later through a VAT mismatch.
See `docs/integrations/oblik-plus.md`.

Measured on the current fixtures: changing `formatDate` to `DD.MM.YYYY` makes
**36 of 36 rows** unimportable, and nothing in this repo turns red unless you
pin the export (we do now — `test/characterization/accounting-export.test.js`).

`config/export-columns.json` may be **reordered** by accounting without a
deploy, but **column types must not change** — they are the dispatch keys.

## There are four independent date/money formatters. `lib/format.js` is only one

| Where | Dates | Amounts |
|---|---|---|
| `lib/format.js` | `formatDate` MM/DD/YYYY, `formatDateUk` DD.MM.YYYY | `formatMoney` `1 234,50 грн`, `formatDecimal` `1234.50` |
| `lib/reports/dates.js` + `lib/reports/table.js` | prints **raw ISO**, plus `monthName()` | own `fmtAmount` (no «грн») |
| `lib/legacy/templates.js:180` | helper `date` — already `DD.MM.YYYY` | own `money` |
| `bin/import-statement.js:16` | prints the parsed date as is | own `fmtAmount` |

**`lib/reports/*` does not require `lib/format.js` at all.** Changing
`lib/format.js` does not touch reports, the monthly cron mail or the BI JSON —
and vice versa. Do not "fix" this duplication as a side quest.

## Who reads what — machine vs human

| Output | Reader | Format frozen? |
|---|---|---|
| `out/export/oblik-*.csv` (`bin/nightly-export.js`, cron 02:30) | **machine** | **yes**, byte-for-byte: `;`, CRLF, header row, MM/DD/YYYY, `1234.50` |
| `GET /api/reports/*`, `bin/monthly-report.js --json` | **machine** (BI spreadsheet) | yes — ISO dates |
| `/invoices/:number`, `bin/render-invoice.js` | human (customer) | no |
| `out/mail/*.txt` (`bin/send-reminders.js`, cron 09:00) | human (customer) | no |
| `bin/monthly-report.js` text | human (director, accounting) | no, but it is pasted into Excel — keep it fixed-width, no tabs |

## `app/docs/` is history, not documentation

`docs/ARCHITECTURE.md` is dated May 2019. Of its 8 substantive claims, **7 are
false today**: Express (gone 2020 → `lib/http/router.js`), MongoDB (gone
2020-11 → JSON files in `data/`), Handlebars `templates/` (directory does not
exist), `lib/export/csv.js` (it is `lib/export/accounting.js`), `lib/mail`
(does not exist; mails are files in `out/mail`), Node 8 (`package.json` says
`>=22`), port 3000 (it is 8080). Only "dates are ISO" and "money is kopecks"
survived.

`docs/integrations/oblik-plus.md`, by contrast, is **accurate and load-bearing**.
Treat every statement in `app/docs/` as a claim to verify against the code —
but do not delete that file: it explains *why* things are the way they are.

## Traps that cost time

- **`lib/audit`**: `audit/routes.js` says entries are written "by the modules
  themselves through `audit.record()`". **Nothing in `lib/` or `bin/` calls
  `record()`** — only tests do. `GET /api/audit` reads a log that production
  code never writes.
- **Dead code**: `lib/discounts/*` (nobody imports it; `config/features.json`
  → `loyaltyDiscounts: false`), `lib/legacy/pdf-client.js` (service switched
  off 2020), `lib/legacy/mongo-migrate.js` (one-off, 2020).
  **But `lib/legacy/templates.js` has live tests** (`test/legacy/templates.test.js`)
  — it is dead in production, not dead in CI. Do not remove it "along the way".
- **`bin/fix-2022-duplicate-customers.js`** — already applied on prod
  2022-08-09. Never run again, never add to cron.
- **Routing**: `/invoices/:number` is **public**; the `x-staff-id` check in
  `lib/http/router.js:101` only fires for paths starting with `/api/`.
- **`store.js`**: `insert`/`update` only mutate the in-memory cache. Without
  `store.save(collection, cb)` nothing reaches disk.
- Dates in `data/*.json` are `YYYY-MM-DD`, money is **integer kopecks**
  (`*_kopecks`). Never store a formatted date.

## Tests

- `npm test` = `node --test`, Node 22, no dependencies, no build.
- **Node collects every `.js` under `test/`**, not just `*.test.js`. A helper
  placed there runs as a test file. Guard incidental code with
  `if (require.main === module)`.
- `test/characterization/` pins the current output of each consumer of
  `lib/format.js`. Golden masters live in `test/characterization/golden/`:

  ```bash
  node --test                     # compare
  UPDATE_GOLDEN=1 node --test     # re-record — only for a DELIBERATE change
  ```

  After re-recording, always check **which** goldens moved:
  `git diff --stat -- app/test/characterization/golden`.
  If `oblik-export.csv`, `monthly-report-*.txt` or `aging-*.json` appear in
  that list, you broke a machine consumer. Fix the code, not the golden.
- `core.autocrlf=input` in this repo. `test/characterization/.gitattributes`
  has `golden/** -text` so git does not rewrite the CRLF that the «Облік-Плюс»
  contract depends on. Verify in the blob, not the worktree:
  `git show HEAD:<path> | file -`.
- Write cleanup in `t.after()`, not after the assertions. A characterization
  test is written **to fail later**; if a server is closed after a failing
  assert, `node --test` hangs instead of reporting.

## House style

CommonJS, callbacks, `var`, no npm dependencies, no build step. This is
deliberate (`lib/store.js`: "please keep it that way until the big rewrite").
Do not convert to ESM/async-await, do not add dependencies, do not rename for
taste. Do not edit `app/data/*.json` — the fixtures are shared by all tests.
Never commit `app/out/`.

