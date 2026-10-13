# LEMONS Data Migrations Ecovia

Internal web tool that migrates cleansed customer-lead data out of **Qonex**
into two independent destinations:

| Module                       | Source                | Destination                                       | Transport                  |
| ---------------------------- | --------------------- | ------------------------------------------------- | -------------------------- |
| **LEMONS / Cosmos DB**       | Qonex Excel (.xlsx)   | `leads` + `leads-won` containers (partition `/id`)| Lemon Vireya API (Phase 2) |
| **SQL Server · Analytics**   | Qonex Excel (.xlsx)   | `dev_analytic_cxlite.analytic_leads_sales` (51 cols) | Secure backend (Phase 2)|

The entire transformation engine, validation engine, batch runner, and
destination adapters are implemented and tested. Phase 1 does NOT open any
real database connection; adapters are explicitly labelled `MOCK` and refuse
to write records flagged `DRY_RUN=1`.

---

## 1. Running locally

Requires Node 20+ (verified on Node 22).

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # type-check + production bundle
npm run lint       # oxlint
npm test           # 55 unit + contract tests via vitest
```

### Verify the UI

1. Open `http://localhost:5173`.
2. Pick a destination card (LEMONS / Cosmos DB or SQL Server Analytics).
3. Upload a Qonex Excel file, or click **"Gunakan data contoh"** for the
   bundled sample dataset.
4. Walk the wizard end-to-end:
   `Upload → Mapping → Validation → Review → Preview → Result`.
   Each step enforces real gating (no structural override is permitted).

---

## 2. Project layout

```
src/
├── config/
│   ├── qonex-source.ts        # 32 known Qonex headers + hints
│   ├── sql-mapping.ts         # 51-column schema for analytic_leads_sales
│   ├── cosmos-mapping.ts      # Cosmos leads / leads-won + Lite/Pro profiles
│   ├── status-taxonomy.ts     # Destination-specific status + source maps
│   └── wizard.ts
├── lib/
│   ├── transform/
│   │   ├── primitives.ts      # phone, date, number, boolean, varchar normalizers
│   │   ├── identifiers.ts     # uuidv4, stableUuid, run / batch IDs
│   │   ├── sql-generator.ts   # Qonex → 51-column SQL rows
│   │   ├── cosmos-generator.ts# Qonex → leads + leads-won documents
│   │   ├── types.ts
│   │   └── index.ts
│   ├── validation/
│   │   ├── engine.ts          # runs transformers, exposes issues to UI
│   │   └── index.ts
│   ├── adapters/
│   │   ├── types.ts           # DestinationAdapter<R> contract
│   │   ├── sql-adapter.ts     # MOCK SQL adapter (validate/prepare/insert/verify/rollbackPreview/reconcile)
│   │   ├── cosmos-adapter.ts  # MOCK Cosmos adapter (two-container router)
│   │   ├── lemon-vireya.ts    # Lemon Vireya API client stub (interface only)
│   │   └── index.ts
│   ├── batch/
│   │   ├── engine.ts          # chunked, pausable/cancellable batch runner
│   │   ├── types.ts
│   │   └── index.ts
│   ├── backend/
│   │   └── contracts.ts       # HTTP contracts for Phase 2 backend
│   ├── excel.ts, mapping.ts, download.ts, transform.ts (back-compat facade), cn.ts
├── state/workflow-store.ts    # Zustand store wired to real engines
├── pages/, components/        # unchanged UI wiring, now backed by real engines
└── __tests__/
    ├── fixtures.ts
    ├── primitives.test.ts
    ├── sql-generator.test.ts
    ├── cosmos-generator.test.ts
    ├── validation.test.ts
    └── batch.test.ts
```

---

## 3. What is real (Phase 1)

- **Excel parse** — browser-side `xlsx`, file never leaves the client.
- **Transformation** — deterministic pure functions, 51 SQL columns + Cosmos
  documents emitted per row with full normalization (phone → E.164,
  UTC+Jakarta pair, decimal(9,6), NVARCHAR truncation, status taxonomy, …).
- **Validation** — real rule engine emits per-row VALID / WARNING / BLOCKED
  issues. Structural warnings (missing required, duplicate IDs, invalid
  dates, missing Won fields) cannot be overridden by acknowledgement.
- **Identifiers** — stable UUIDv4 derived from source IDs so a dry-run and a
  re-run produce the same `leads_id`. `wa_<normalizedPhone>` with configurable
  prefix for Cosmos Lite + SQL `leads_wa_mobile`.
- **Batch engine** — chunking, sequential execution, pause/resume/cancel,
  per-record result tracking, retry queue, idempotency hash list, recovery
  manifest, reconcile report, rollback preview.
- **MOCK adapters** — simulated writes labelled `simulated: true`. They
  REFUSE to insert records with the DRY_RUN flag set, so no accidental
  "simulated success" is ever reported as production.

## 4. What is still mocked

- SQL Server, Cosmos DB, and Lemon Vireya network calls — the adapters do
  not open sockets. Production adapters implement the same
  `DestinationAdapter<R>` interface; wiring them in Phase 2 is a single
  factory swap.
- Lemon Vireya endpoints, auth, and batch contract — the stub throws if
  `send()` is called. No endpoint / token / tenant is invented in the code.
- The Phase 2 backend layer (`src/lib/backend/contracts.ts`) ships
  TypeScript shapes only, no concrete `fetch` client, no secrets.

---

## 5. Testing

```bash
npm test     # 55 tests across 5 files
```

Coverage areas:
- primitives (phone, email, date / Jakarta TZ, Excel serials, numerics,
  boolean, varchar clamp)
- SQL generator (51-column emission, stable UUIDs, duplicate IDs blocked,
  duplicate phones warned, varchar truncation, timestamp pair, 8 000-row
  scale run under 5 s, parameterized preview)
- Cosmos generator (Lite vs Pro ID semantics, duplicate policy, empty
  history arrays, no `_rid` fabrication, won snapshot requires all fields,
  batch array routes containers)
- Validation engine (unknown status warning, structural non-overridable,
  non-structural overridable, per-row descriptions)
- Batch engine (DRY_RUN refusal, LIVE insert, retry queue populated and
  retried, reconcile matches, chunk arithmetic, Cosmos routing)

---

## 6. Local-run guidance for next tasks

The migration tool is ready for Phase 2 — local database preparation. The
sequence a database task should follow:

1. Start containers (SQL Edge + Cosmos Emulator) via a separate script.
   The front-end does NOT need the containers to run.
2. Apply the Phase 2 backend (reads credentials from env, exposes the HTTP
   routes defined in `src/lib/backend/contracts.ts`).
3. Replace `createMockSqlAdapter()` and `createMockCosmosAdapter()` in
   `src/state/workflow-store.ts` with HTTP-backed adapters that proxy to
   the backend.
4. Flip `dryRun` to a user-controlled option in the UI once the real
   adapter is live; MOCK adapter does not require this change.

---

## 7. Known open data rules (require stakeholder decisions)

| # | Area | Needs resolution |
| - | ---- | ---------------- |
| 1 | SQL DDL vs 51-col shape here | Confirm every column name, type, nullability and index |
| 2 | Lemon Vireya API | Endpoints, authentication model, batch limits, idempotency keys |
| 3 | SQL deploy env | Hostname, credential handling (expected: via backend KMS) |
| 4 | Full status taxonomy | Beyond HOT/WARM/COLD/WON/DROPPED — confirm complete enum |
| 5 | Source taxonomy | Normalisation rules for digital / offline / referral etc. |
| 6 | Pro duplicate policy | Phone+assignedTo repeats: block, warn, or upsert? |
| 7 | Company resolution | Is Qonex `group` the authoritative company field? |
| 8 | Sales rep identity | Free-text (current) vs FK lookup table |
| 9 | Won deal column names | Column names (`deal_value`, `ktp`, `block`, `unit_number`) assumed — confirm |
| 10 | DATETIME2 tz | Confirm Jakarta local → UTC conversion is correct for analytics |

---

## 8. Deliverables status

| Deliverable | Status |
| ----------- | ------ |
| Mapping & transformation engine | **done** (`src/lib/transform/`) |
| Real validation engine          | **done** (`src/lib/validation/`) |
| SQL-ready record generator      | **done** (51 columns) |
| Cosmos `leads` generator        | **done** (Lite + Pro) |
| Cosmos `leads-won` generator    | **done** (strict Won validation) |
| Destination adapter interfaces  | **done** (`src/lib/adapters/`) |
| Batch / retry / reconciliation  | **done** (`src/lib/batch/`) |
| Integration with existing UI    | **done** (store + preview + result steps) |
| Automated tests                 | **done** (55 passing) |
| Local run instructions          | this README §1 |
| Unresolved data rules           | this README §7 |

Database provisioning is intentionally OUT of scope for this task.
