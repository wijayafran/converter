# LEMONS Data Migrations Ecovia

Internal web tool (formerly branded *Qonex Data Migration Studio*) that helps
non-technical users migrate cleansed customer lead data out of **Qonex** into
two independent destinations:

| Module                  | Source                | Destination                 | Transport               |
| ----------------------- | --------------------- | --------------------------- | ----------------------- |
| **Lemon / CXLite**      | Qonex Excel (.xlsx)   | Lemon-compatible JSON       | Lemon API (Phase 2)     |
| **SQL Server**          | Qonex Excel (.xlsx)   | `dbo.leads` row inserts     | Secure backend (Phase 2)|

> **Phase 1 scope.** This repository contains the UI/UX prototype only. No real
> HTTP requests to Lemon are made, no SQL Server inserts happen, and no customer
> file ever leaves the browser.

---

## 1. Running locally

Requires Node 20+ (verified on Node 22).

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # production bundle
npm run lint       # oxlint — type-aware is off until API lands
```

### Verify the UI

1. Open `http://localhost:5173`.
2. Pick a destination card (Lemon / CXLite or SQL Server).
3. Upload a Qonex Excel file, **or** click **"Gunakan data contoh"** to load
   the bundled 3-row illustrative dataset.
4. Walk the wizard end-to-end: Upload → Mapping → Validation → Review → Preview
   → Result. Each step enforces the gating condition described in §3.

---

## 2. Project layout

```
src/
├── pages/
│   ├── LandingPage.tsx       # Destination selection cards
│   └── WorkflowPage.tsx      # Wizard orchestrator (shared by both modules)
├── components/
│   ├── layout/AppShell.tsx
│   ├── wizard/
│   │   ├── MigrationWizard.tsx
│   │   └── steps/            # 6 step components
│   ├── shared/               # DestinationCard, ExcelUpload, MappingTable…
│   └── ui/                   # Hand-rolled shadcn-style primitives
├── config/
│   ├── qonex-source.ts       # 32 known source headers + hints
│   ├── lemon-mapping.ts      # Illustrative Qonex → Lemon mapping (pending verification)
│   ├── sql-mapping.ts        # Illustrative Qonex → SQL mapping (pending verification)
│   └── wizard.ts
├── state/workflow-store.ts   # Zustand store shared by both workflows
├── lib/
│   ├── excel.ts              # Real client-side xlsx parser
│   ├── transform.ts          # Qonex → Lemon JSON / SQL rows transform
│   ├── mapping.ts            # Mapping summary + proceed guards
│   ├── download.ts           # Blob/JSON download helpers
│   └── cn.ts
├── mocks/
│   ├── sample-rows.ts        # 3-row illustrative dataset (all 32 columns)
│   └── validation.ts         # Mock validation issues (clearly labeled)
├── types/index.ts
├── App.tsx
└── main.tsx
```

---

## 3. User journey & gating

Each workflow (Lemon or SQL) follows the same six-step wizard:

| Step               | Gate to continue                                          | Real vs mocked |
| ------------------ | --------------------------------------------------------- | -------------- |
| 1. Upload Excel    | File parsed (headers, row count resolved)                 | **Real** (xlsx client-side) |
| 2. Field Mapping   | All *required* destination fields have a source           | **Real** mapping UI |
| 3. Data Validation | Validation has been run                                   | **Mocked** issue set |
| 4. Review Results  | No `BLOCKED` row remains undecided                        | Real decision tracking |
| 5. Preview & Confirm | User explicitly confirms the simulation                 | **Real** JSON / SQL preview rendering, **Mocked** API call |
| 6. Migration Result | Final step — report download available                   | **Mocked** result summary |

The destination is chosen **before** upload (per spec) and persists for the
entire wizard.

---

## 4. What's real vs mocked — explicitly

### Real behaviors in Phase 1

- Excel parsing (`xlsx` library) runs entirely in the browser. The file never
  leaves the client.
- Field mapping UI reads the uploaded file's actual headers and lets the user
  reassign source columns.
- Lemon JSON output is generated from the actual mapping over the actual data,
  including transforms (phone → E.164, email lowercase, dates → ISO, lat/lng
  rounding to 6 decimals, bookmark → boolean).
- SQL preview renders rows and `INSERT INTO dbo.leads …` statements derived
  from the actual data.
- "Download JSON" and "Download report" produce real file blobs.

### Mocked behaviors in Phase 1

- **Validation engine** returns an illustrative issue set from `src/mocks/validation.ts`.
  Row numbers in the issue table are deliberately overlaid onto the real data so
  the UI feels plausible. **Approving a warning or excluding a row does drive
  the simulated migration numbers**, but the validation rules themselves are
  not yet implemented.
- **Lemon API submission** is disabled (button labelled *"Submit to Lemon API
  (Phase 2)"*).
- **SQL Server execution** is disabled (buttons labelled *"Test Connection
  (Phase 2)"* and *"Execute INSERT (Phase 2)"*).
- **Migration result** is simulated. The `MigrationResult` surface prominently
  carries a `SIMULATED` badge and a warning Alert so no viewer mistakes it for
  a real run.

---

## 5. Architecture notes for Phase 2 and Phase 3

### Phase 2 — real integrations (two independent tracks)

Both tracks share:

- A **validation engine** (`src/lib/validation/`, to be created). The current
  mock exports a `ValidationIssue[]` shape — Phase 2 can replace
  `buildMockIssues()` with a real rule set without changing the UI.
- A **job queue** or batch runner that reports progress to the UI. The
  `MigrationResultSummary` type already matches the expected shape.

**Lemon track**

- Add a backend adapter (`/api/lemon/submit`) that accepts a batch of transformed
  records and forwards to Lemon / CXLite.
- Keep customer Excel files on the client; the backend only sees already-transformed JSON.
- Azure Cosmos DB is the eventual store of record; the Lemon API is the write path.

**SQL Server track**

- Add a backend adapter (`/api/sql/preview-connection` and `/api/sql/execute`)
  that opens a parameterized connection using credentials from the backend
  environment — **never from the browser**.
- Prefer stored procedures or parameterized `INSERT` statements. The current
  preview deliberately uses a parameter-friendly structure.

### Phase 3 — reconciliation, reporting, resilience

- Reconciliation report comparing Qonex counts vs destination counts (per batch).
- Retry UI driven by `MigrationResultSummary.failed > 0 && retryable`.
- Import status tracking by batch ID (`SIM-…` → real `JOB-…` identifiers).
- Audit log of user decisions (approve, exclude) exported with the report.

### Future dev-env guidance (not implemented now)

- Apple Silicon friendly:
  - Cosmos DB Emulator: historically ARM-shaky — plan for the Linux emulator image
    behind Rosetta or a hosted dev tenant.
  - SQL Server: `mcr.microsoft.com/azure-sql-edge` is ARM-native and sufficient
    for local DDL/insert work.
- Do **not** auto-start containers from `npm run dev`; Phase 1 keeps the dev
  loop container-free.

---

## 6. Assumptions

1. The uploaded Excel file has already been cleansed (per prompt).
2. All 32 Qonex headers listed in `src/config/qonex-source.ts` are present
   when the file is in canonical shape; the mapping screen handles missing /
   extra columns gracefully.
3. Phone numbers are Indonesian (`0…`, `+62…`, or `62…` prefix) and normalize
   to E.164 `+62…`.
4. Latitude/longitude precision in SQL Server is `DECIMAL(9,6)` — any extra
   decimals are flagged as precision loss, never silently rounded without a
   warning.
5. User decisions ("approve warning", "exclude row") are session-scoped. They
   are intentionally not persisted; a fresh browser session starts clean.
6. A record is uniquely identified by the Qonex `ID` field for duplicate
   detection (to be confirmed in Phase 2 — see open questions).

---

## 7. Open questions / missing specifications

These must be answered before Phase 2 wiring is enabled:

| # | Area                         | Needed from stakeholder                                      |
| - | ---------------------------- | ------------------------------------------------------------ |
| 1 | Lemon JSON schema            | Authoritative shape and required fields of a Lemon lead      |
| 2 | Lemon API endpoint           | URL, auth model, batch size limits, idempotency rules        |
| 3 | SQL Server DDL               | Full `dbo.leads` column list, types, nullability, indexes    |
| 4 | SQL deploy environment       | Hostname, credential handling (expect: via backend KMS)      |
| 5 | Status taxonomy              | Mapping from Qonex `status` strings to Lemon / SQL vocab     |
| 6 | Source taxonomy              | Normalization for `source_data` / `category_source`          |
| 7 | Duplicate detection key      | Is `ID` canonical, or should we hash `(email, phone)` as backup? |
| 8 | Date/locale                  | Confirm Jakarta timezone + Excel date serialization quirks   |
| 9 | PII handling / retention     | Browser-only parsing is the Phase 1 default — confirm        |
| 10 | Sales rep identity            | Free-text (current) vs lookup against a reference table      |

Every mapping entry whose `verified: false` is explicitly flagged in the UI
with a *"Mapped · Unverified"* badge so stakeholders can see what remains to
confirm.

---

## 8. Known Phase 1 limitations

- No automated UI tests yet (manual verification only).
- Bundle is a single ~700 kB chunk (Vite emits a size warning). Code-splitting
  is a Phase 2 optimization.
- Oxlint runs with the default correctness rules only. `oxlint-tsgolint`
  type-aware pass can be enabled once the ambient Lemon API types are added.
- Dark mode token scaffolding is present (CSS vars) but no toggle is shipped.

---

## 9. Files created in Phase 1

```
src/
  App.tsx, main.tsx, index.css
  types/index.ts
  state/workflow-store.ts
  config/{qonex-source,lemon-mapping,sql-mapping,wizard}.ts
  lib/{cn,excel,transform,mapping,download}.ts
  mocks/{sample-rows,validation}.ts
  pages/{LandingPage,WorkflowPage}.tsx
  components/
    layout/AppShell.tsx
    wizard/MigrationWizard.tsx
    wizard/steps/{Upload,Mapping,Validation,Review,Preview,Result}Step.tsx
    shared/{DestinationCard,ExcelUpload,FileSummary,MappingStatusBadge,
            MappingSummaryCards,MappingTable,ValidationSummary,
            ValidationIssueTable,DataPreview,JsonPreview,SqlPreview,
            ConfirmationDialog,MigrationResult,states}.tsx
    ui/{button,card,badge,input,select,table,tabs,dialog,progress,alert,separator}.tsx
```

Config files modified:
- `tsconfig.app.json` — added `paths: { "@/*": [...] }`.
- `vite.config.ts` — added `@/` alias.
- `tailwind.config.js` — tokens, container, fonts.
- `postcss.config.js` — Tailwind + autoprefixer.
- `index.html` — title, Google Fonts preload.
