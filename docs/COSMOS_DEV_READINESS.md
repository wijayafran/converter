# Cosmos DEV Readiness — Qonex → LEMONS / CXLite

| Scope | Value |
| --- | --- |
| **Data Mapping baseline** | **13 October 2026, 12:00 PM WIB** |
| Repository HEAD | `4ad0811` (pushed to `origin/main`) |
| Target environment | **Azure DEV Cosmos** (coordinated with Raka) |
| Local emulator status | **Abandoned** — Apple M2 / Rosetta incompatibility |
| Pending contracts | Lemon Vireya API, Azure DEV Cosmos access |
| First UAT size | **5 synthetic records** |

> Catatan: dokumen ini **planning saja**. Tidak ada koneksi ke Azure DEV, tidak ada perubahan kode Cosmos, tidak ada migrasi SQL.

## 1. Executive summary

Dua jalur migrasi di repo ini **independen**:

```
Qonex Excel ──► SQL Analytics (dev_analytic_cxlite.analytic_leads_sales)  ──► COMPLETED LOCAL UAT 14-Okt-2026
            └─► Lemon / CXLite (Azure Cosmos DB)                           ──► NEXT: DEV UAT (dokumen ini)
```

Semua kode Cosmos sudah ada di HEAD (`4ad0811`), siap dipakai di DEV **tanpa modifikasi** begitu kontrak dan akses tersedia. Dokumen ini mencatat **titik integrasi** dan **blocker** sebelum eksekusi.

## 2. Existing Cosmos code — integration points (no changes required)

| Area | File | Line range | Function |
| --- | --- | --- | --- |
| JSON generator (document shape) | `src/lib/transform/cosmos-generator.ts` | 1–460 | `transformToCosmos(parsed, options)` → `{ leads, wonSnapshots, summary }` |
| Lite / Pro profile config | `src/config/cosmos-mapping.ts` | 17–39 | `CosmosProductProfile` type + `CosmosConfig` interface |
| Container & partition keys | `src/config/cosmos-mapping.ts` | 19–22 | `COSMOS_DATABASE_NAME = 'cxlite'`, `COSMOS_LEADS_CONTAINER = 'leads'`, `COSMOS_LEADS_WON_CONTAINER = 'leads-won'`, `COSMOS_PARTITION_KEY = '/id'` |
| Lead document type | `src/lib/transform/cosmos-generator.ts` | 60–94 | `CosmosLeadDocument` |
| Won/Dropped snapshot type | `src/lib/transform/cosmos-generator.ts` | 96–118 | `CosmosWonDocument` (6-char `id` from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, `_partitionKey = id`, `originalLeadId` FK) |
| Container routing | `src/lib/transform/cosmos-generator.ts` + `src/lib/adapters/cosmos-adapter.ts` + `server/cosmos-adapter.ts` | gen: 640–661 (`buildCosmosBatchArray`); mock: 49–50 (`containerFor`); live: 76–77 (`containerForDoc`) | Documents are routed by presence of `originalLeadId` → `leads-won`, else `leads` |
| Mock Cosmos adapter (unit tests) | `src/lib/adapters/cosmos-adapter.ts` | 34–225 | Honours `DestinationAdapter<CosmosWritable>` contract |
| Live Cosmos adapter (SDK-backed) | `server/cosmos-adapter.ts` | 29–222 | `@azure/cosmos` client; `validateConnection`, `prepareBatch`, `insertBatch`, `verifyInsertedRecords`, `previewRollback`, `reconcile` |
| Lemon Vireya API stub | `src/lib/adapters/lemon-vireya.ts` | 1–78 | Interface-only; `send()` throws until the real contract lands |
| Env + credentials (server-side) | `server/env.ts` | 65–72 | `cosmos: { endpoint, key, databaseId, leadsContainerId, leadsWonContainerId, partitionKeyPath }` — read from `process.env` only |
| Backend HTTP contract | `src/lib/backend/contracts.ts` | all | `/api/cosmos/validate-connection`, `/api/cosmos/ensure`, `/api/cosmos/execute-batch`, `/api/cosmos/reconcile` |
| Backend server routes | `server/index.ts` | all | Exposes the HTTP contract; refuses LIVE if `COSMOS_KEY` is empty |

### 2.1 Document shape — `leads` container

```ts
// src/lib/transform/cosmos-generator.ts:60–94
export interface CosmosLeadDocument {
  id: string            // Lite: wa_<digitsPhone>; Pro: UUIDv4
  _partitionKey?: string
  name: string
  customerPhone: string // digits only (62…), no '+'
  customerEmail: string | null
  phonePermission: boolean
  ktp: string           // empty unless Won
  address: string | null
  project: string
  cluster: string
  status: string        // CXLite canonical (New / Contacted / In Discussion / Site Visit / Won / Dropped / Cancelled)
  qualificationLevel: string
  urgency: string
  source: string        // CXLite source taxonomy (pending canonicals preserved raw)
  // … + createdOn, changedOn, createdBy, assignedTo, interactions[], reassignmentTriedAgents[], etc.
}
```

### 2.2 Document shape — `leads-won` container

```ts
// src/lib/transform/cosmos-generator.ts:96–118
export interface CosmosWonDocument {
  id: string            // 6-char from ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no 0, O, 1, I)
  _partitionKey: string // = id
  originalLeadId: string // FK to leads.id
  name: string
  project: string
  cluster: string
  blok: string          // 1–50 chars (note: Indonesian spelling)
  unitNumber: string    // 1–50 chars
  customerPhone: string
  customerEmail: string | null
  dealValue: string     // digits only, > 0, ≤ 1,000,000,000,000
  ktp: string           // exactly 16 digits
  // … + closedDate, closedBy, createdAt, source, company, originalCreatedOn, originalCreatedBy, status
}
```

### 2.3 Routing rule

Documents are already routed in `buildCosmosBatchArray` (`src/lib/transform/cosmos-generator.ts:601–620`) and both adapters (`cosmos-adapter.ts:42–47` and `server/cosmos-adapter.ts:76–77`) use **the same predicate**:

```
containerForDoc(doc) = 'originalLeadId' in doc ? 'leads-won' : 'leads'
```

Partition key for **both containers** is `/id`.

## 3. Information required from Raka (before any DEV call)

| # | Item | Blocking for | Suggested evidence |
| --- | --- | --- | --- |
| R-01 | **Azure DEV Cosmos endpoint** (`https://<account>.documents.azure.com:443/`) | Any connection attempt | Portal URL + resource group |
| R-02 | **Primary key / token** (least-privilege read+write on `cxlite` database only) | Any connection attempt | Rotate before/after UAT |
| R-03 | **Authorized access confirmation** — my IAM principal (or shared service identity) has `Cosmos DB Data Contributor` on the DEV database (not account-wide) | Any connection attempt | `az role assignment list` output |
| R-04 | **Database + container names** — confirm `cxlite` database, `leads` + `leads-won` containers already exist, or whether UAT may call `ensureDatabaseAndContainers()` | `prepareBatch` + first `insertBatch` | Portal screenshot showing containers and partition key `/id` |
| R-05 | **Partition key path** — confirm `/id` on both containers (matches `src/config/cosmos-mapping.ts:22`) | Document creates | Portal screenshot |
| R-06 | **Product profile** — Lite or Pro? Drives `id` format (`wa_<phone>` vs UUIDv4) and duplicate policy | `transformToCosmos({ config: { profile } })` | Written decision |
| R-07 | **`NEXT_PUBLIC_ALLOW_DUPLICATE_LEADS`** value for the DEV tenant | Pro profile duplicate handling | Env value |
| R-08 | **Required field closure** — company and assignedTo must resolve against `companies` and `users` containers. For 5-record UAT, provide valid test values | Won/Lead inserts | List of valid `company` + `assignedTo` names |
| R-09 | **Lemon Vireya API contract** — endpoints, auth model (OAuth / API key / mTLS?), batch size limits, idempotency key policy | API-path testing | OpenAPI spec or Postman collection |
| R-10 | **Lemon Vireya DEV endpoint** + rotated test token | API-path testing | Secrets handoff via secure channel (NOT in git) |
| R-11 | **Idempotency behaviour** — does Cosmos (direct) treat duplicate `id` as 409 only, or does the Vireya API dedupe silently? | Retry safety | Documented behaviour |
| R-12 | **Read-back verification policy** — are we allowed to `SELECT` our own writes immediately, or is there a consistency delay to respect? | `verifyInsertedRecords` | Session consistency level |
| R-13 | **Failure handling / rollback** — can we delete our own writes if UAT needs rollback? (Our adapter's `previewRollback` is non-destructive; actual DELETE would need explicit permission) | Cleanup after UAT | Written approval + which path |
| R-14 | **Rate limits / RU/s** — expected throughput ceiling on DEV database | Batch sizing | Portal RU setting |
| R-15 | **Pending source canonicals** (Rumah123 / SML Website / Website Ecovia / Official - FB IG Ads Form) — approval status for CXLite | What `leads_source` will be written | Sign-off reference |
| R-16 | **Pending status canonicals** (`Send Pricelist`, `Follow Up Leads`) — approval status for FSM group | What rows are eligible | Sign-off reference |

Items **R-01 to R-14** are blockers for Cosmos UAT. **R-15 and R-16** carry over from SQL UAT and remain pending.

## 4. Prerequisites — engineering side (ready in repo)

| Item | Status |
| --- | --- |
| Cosmos JSON generator (Lite + Pro profiles) | ✅ ready |
| Won snapshot generator with 6-char id + strict validation | ✅ ready |
| `_partitionKey = id` on leads-won; informational on leads | ✅ ready |
| Phone normalization (digits-only `62…`) | ✅ ready |
| Status pipeline (shared with SQL side) | ✅ ready; identical set of pending-mapping blockers |
| Mock Cosmos adapter (16 vitest regression tests) | ✅ ready — never touched Azure |
| Live Cosmos adapter (`server/cosmos-adapter.ts`) | ✅ ready — uses `@azure/cosmos` SDK |
| Backend HTTP contract for Cosmos routes | ✅ ready |
| Server-side env (`COSMOS_ENDPOINT`, `COSMOS_KEY`, `COSMOS_DATABASE`, `COSMOS_LEADS_CONTAINER`, `COSMOS_LEADS_WON_CONTAINER`) | ✅ ready; `assertLiveReady()` refuses LIVE if key is empty |
| Lemon Vireya client | 🟡 interface-only stub; `send()` throws until contract lands |
| Automated tests at HEAD | ✅ 131/131 pass (16 of them are Cosmos-specific) |
| Local emulator setup | ❌ abandoned (ARM/Rosetta); DEV only |

## 5. Prerequisites — operational side (not in repo)

| Item | Owner | Status |
| --- | --- | --- |
| Azure DEV Cosmos account + database created | Raka | ⏳ |
| Role assignment confirmed for my identity | Raka | ⏳ |
| Containers `leads`, `leads-won` with partition `/id` | Raka | ⏳ |
| `companies` + `users` seed data for 5-record UAT | Raka | ⏳ |
| Secrets handoff channel (NOT in git) | Raka + me | ⏳ |
| Lemon Vireya API contract (if API-path is part of this UAT) | Raka / Vireya team | ⏳ |
| Rollback approval policy | Raka | ⏳ |

## 6. Unresolved blockers

1. **No Lemon Vireya contract.** The engine stub throws on `send()`. Until R-09/R-10 land, **API-path testing cannot run**. Direct Cosmos DEV path can run earlier if R-01 through R-14 are complete.
2. **Pending source + status canonicals.** Rows that hit pending mappings will emit non-overridable warnings/blocks. These do NOT block Cosmos integration (the engine already preserves raw values), but should be acknowledged in the UAT narrative.
3. **Secrets governance.** `COSMOS_KEY` must stay in `.env` (gitignored) or in a managed secret store. The server refuses LIVE without it.
4. **Rollback permission.** Our adapter's `previewRollback` reports only; a destructive DELETE path is not wired. If Raka needs rollback after UAT, we need either (a) explicit approval + a new endpoint, or (b) a Raka-side cleanup script.

## 7. Testing-path distinction

```
Direct Cosmos DEV path                        API-path (Lemon Vireya)
──────────────────────                       ────────────────────────
Browser → backend  →  Azure Cosmos           Browser → backend → Lemon Vireya API → ???
         (@azure/cosmos SDK)                           (http client, pending contract)

tests → cosmos-adapter.ts direct             tests → lemon-vireya.ts stub
server/cosmos-adapter.ts (ready)             src/lib/adapters/lemon-vireya.ts (stub only)
```

**A green direct-Cosmos UAT does NOT validate the API-path.** The two paths differ in authentication, retry policy, idempotency key handling, and side-effects. The UAT plan (see `docs/COSMOS_DEV_UAT_PLAN.md`) exercises them separately with explicit gates.

## 8. Explicit non-changes in this planning task

- `src/lib/transform/cosmos-generator.ts` — not touched.
- `src/config/cosmos-mapping.ts` — not touched.
- `src/lib/adapters/cosmos-adapter.ts`, `src/lib/adapters/lemon-vireya.ts` — not touched.
- `server/cosmos-adapter.ts` — not touched.
- No new deps, no Docker, no local emulator.
- No connection to Azure DEV. No Cosmos documents written.
- No SQL writes.

Data Mapping baseline: **13 October 2026, 12:00 PM WIB**. HEAD: `4ad0811`.
