# Cosmos DEV UAT Plan — 5 Synthetic Records

| Scope | Value |
| --- | --- |
| **Data Mapping baseline** | **13 October 2026, 12:00 PM WIB** |
| Repository HEAD | `4ad0811` (pushed to `origin/main`) |
| Target environment | **Azure DEV Cosmos** (coordinated with Raka) |
| Dataset size | **5 synthetic records** |
| Local prerequisites | 131/131 tests passing at HEAD; mock Cosmos adapter proven |
| Local emulator | Not used (abandoned per ARM/Rosetta constraints) |

> **Planning only.** Prerequisites and blockers in `docs/COSMOS_DEV_READINESS.md`. This plan does not run itself.

## 1. Goals

1. Prove that the **engine's JSON output** matches the shapes real CXLite documents expect.
2. Prove that **routing to `leads` + `leads-won`** works end-to-end against Azure DEV.
3. Prove that **read-back verification** confirms writes in Azure DEV.
4. Separately prove (when R-09/R-10 land) that the **Lemon Vireya API path** accepts the same payload shape.

Non-goals:
- Not a performance test.
- Not a scale test (RU/s tuning is out of scope at 5 records).
- Not an idempotency soak test.
- Does **not** validate pending-canonical business decisions — those remain owned by Ecovia.

## 2. Dataset — 5 synthetic Qonex rows (dummy)

> Nilai `ktp`, `nomor_telepon`, dsb. **sepenuhnya sintetik**. Tidak ada data pelanggan nyata.

| Row | ID | Status | Source | Phone | Deal / KTP / Blok / Unit | Expected target container |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `COSUAT-0001` | `New` | `Ads` | `0812-0000-0001` | — | `leads` only |
| 2 | `COSUAT-0002` | `Contacted` | `Referral` | `0812-0000-0002` | — | `leads` only |
| 3 | `COSUAT-0003` | `In Discussion` | `Rumah123` *(pending canonical)* | `0812-0000-0003` | — | `leads` only · WARNING `pending-source-mapping` |
| 4 | `COSUAT-0004` | `Won` | `Ads` | `0812-0000-0004` | deal=`2500000000`, ktp=`3201012345678901`, project=`Grand Ecovia`, cluster=`Altara Prime`, blok=`A`, unit=`A-12`, closed_on=`2026-10-14` | `leads` + `leads-won` |
| 5 | `COSUAT-0005` | `Dropped` | `Walk-in` | `0812-0000-0005` | ktp=`3201012345670002`, project=`Grand Ecovia`, cluster=`Altara Prime`, blok=`B`, unit=`B-02`, closed_on=`2026-10-14` | `leads` + `leads-won` |

Row 3 surfaces a known **pending-source-mapping** warning (`Rumah123` → proposed `Partnership` is NOT applied; raw preserved). That is intentional — the UAT verifies the engine does not silently promote the proposal.

Row 5 (`Dropped`) still goes to `leads-won` as a snapshot in the Won/Dropped lifecycle, per buat-ricad §3.

## 3. Expected JSON (dummy — row 1)

```json
{
  "id": "wa_6281200000001",
  "_partitionKey": "ads",
  "name": "Prospek 0001",
  "customerPhone": "6281200000001",
  "customerEmail": "cosuat0001@example.com",
  "phonePermission": true,
  "ktp": "",
  "address": null,
  "project": "",
  "cluster": "",
  "status": "New",
  "qualificationLevel": "Medium",
  "urgency": "Medium",
  "source": "Ads",
  "referensi": "",
  "productInterest": null,
  "utmCampaign": "",
  "customerBudget": null,
  "financing": null,
  "timeline": null,
  "notes": null,
  "company": "<fill from Raka seed>",
  "assignedTo": "<fill from Raka seed>",
  "assignedBy": "<fill from Raka seed>",
  "assignedAt": "2026-10-14T...Z",
  "reassignmentTriedAgents": [],
  "preferredLocation": "",
  "interactions": [],
  "createdOn": "2026-10-14T...Z",
  "changedOn": "2026-10-14T...Z",
  "createdBy": "<fill from Raka seed>",
  "updatedBy": "<fill from Raka seed>",
  "legacyCrmId": "COSUAT-0001"
}
```

## 4. Expected JSON (dummy — row 4 Won snapshot)

```json
{
  "id": "<6-char from ABCDEFGHJKLMNPQRSTUVWXYZ23456789>",
  "_partitionKey": "<same as id>",
  "originalLeadId": "wa_6281200000004",
  "name": "Prospek 0004",
  "project": "Grand Ecovia",
  "cluster": "Altara Prime",
  "blok": "A",
  "unitNumber": "A-12",
  "customerPhone": "6281200000004",
  "customerEmail": "cosuat0004@example.com",
  "dealValue": "2500000000",
  "ktp": "3201012345678901",
  "company": "<fill from Raka seed>",
  "source": "Ads",
  "originalCreatedOn": "2026-10-14T...Z",
  "originalCreatedBy": "<fill from Raka seed>",
  "status": "Won",
  "closedDate": "2026-10-14T00:00:00.000Z",
  "closedBy": "<fill from Raka seed>",
  "createdAt": "2026-10-14T00:00:00.000Z",
  "legacyCrmId": "COSUAT-0004"
}
```

## 5. Test paths (separate — green on one does NOT imply the other)

### Path A — Direct Cosmos DEV (SDK)

```
browser (SQL Local Test toggle, Cosmos variant)
   │
   ▼
backend /api/cosmos/* (server/cosmos-adapter.ts)
   │  @azure/cosmos SDK
   ▼
Azure DEV Cosmos (`cxlite` database)
   ├── leads container      (/id)
   └── leads-won container  (/id)
```

**Prerequisites** (`docs/COSMOS_DEV_READINESS.md` R-01 to R-14).

### Path B — Lemon Vireya API

```
browser
   │
   ▼
backend /api/lemon-vireya/submit  (currently returns 403 — client is a stub)
   │  (HTTP client, per Vireya contract)
   ▼
Lemon Vireya API → ??? → Azure Cosmos
```

**Prerequisites** R-09, R-10. Not runnable until the contract lands. Dokumen ini mencantumkan jalur Path B agar jelas bahwa Path A yang berhasil **tidak** memvalidasi Path B.

## 6. Execution sequence (per path)

### Pre-flight (common)

| # | Step | Expected result | Evidence |
| --- | --- | --- | --- |
| P-01 | `npm test` at HEAD | 131/131 pass | terminal output |
| P-02 | `npm run build` | clean | — |
| P-03 | `scripts/poc-cosmos.ts` (dry-dry: `MIGRATION_LIVE=false`) | script exits with "LIVE required" | logs |
| P-04 | Browser preview with 5 synthetic records, Cosmos destination, Dry Run | `blocked=0 (or 1 for pending-source-row 3)`, `eligible=5`, `attempted=5`, `inserted=0`, `verified=null` | screenshot |
| P-05 | Download `cosmos-leads-dry-run.json` + `cosmos-leads-won-dry-run.json` | 5 leads · 2 won snapshots · each matches §3 / §4 shape | file hash |

### Path A gates

| # | Step | Expected result | Fail-stop criteria |
| --- | --- | --- | --- |
| A-01 | `POST /api/cosmos/validate-connection` | 200 + `destinationLabel` includes `cxlite`, `leads`, `leads-won` | any 4xx/5xx → stop, report, no retry |
| A-02 | `POST /api/cosmos/ensure` | 200 OK (idempotent if containers already exist) | errors → stop |
| A-03 | `POST /api/cosmos/execute-batch` (5 leads) | 5 inserted, 0 failed, 0 conflicts | any failed → stop |
| A-04 | `POST /api/cosmos/execute-batch` (2 won snapshots) | 2 inserted, 0 failed, 0 conflicts | same |
| A-05 | `POST /api/cosmos/reconcile` on each batch | observed = expected; `missing = []` | any missing → stop |
| A-06 | Re-run A-03 with the same payload | expected: 5 conflicts (409), 0 inserted — idempotency | if 0 conflicts → stop (writes may be duplicating) |
| A-07 | Browser Result page | `source=5 · blocked=0 (or 1) · eligible=4 or 5 · attempted=4 or 5 · inserted=4 or 5 · verified=4 or 5` | chain inconsistency banner → stop |
| A-08 | Raka manual portal check | 5 leads with expected ids present; 2 won snapshots with expected 6-char ids present; `originalLeadId` back-ref correct | — |
| A-09 | Rollback (if approved under R-13) | A separate Raka-side script OR manual portal delete of the 7 UAT ids | — |

### Path B gates (deferred until Vireya contract lands)

| # | Step | Expected result | Fail-stop criteria |
| --- | --- | --- | --- |
| B-01 | Read Vireya OpenAPI/Postman docs | engineering notes added to `src/lib/adapters/lemon-vireya.ts` | — |
| B-02 | Implement `createLemonVireyaClient()` using the real contract | passes new unit tests | — |
| B-03 | New backend route `/api/lemon-vireya/submit-batch` reading creds from `env.ts` | 200 on dry calls | — |
| B-04 | Replay same 5 records through the API path, in a tenant Vireya marks as DEV | ack from Vireya + verifiable records in Cosmos (via Raka's portal or Vireya's status endpoint) | any discrepancy → stop |
| B-05 | Cross-check between A-08 and B-04: are the records semantically the same, or does Vireya alter payload shape? | documented delta | — |

## 7. Reporting template (fill after UAT)

```
Path A — Direct Cosmos DEV
──────────────────────────
Executed on: 2026-10-?? by …
Run id:      COSRUN-...
Chain:       source=5 · blocked=? · eligible=? · attempted=? · inserted=? · verified=?
Leads inserted ids:        …
Won snapshots inserted ids: …
originalLeadId cross-check: PASS / FAIL
Idempotency re-run conflicts: ?
Rollback status: not run / Raka cleanup / explicit DELETE approval under R-13
Business reviewer: …
Business sign-off: ⏳ awaiting

Path B — Lemon Vireya API
─────────────────────────
Status: BLOCKED by R-09 / R-10. Not executed.
```

## 8. Explicit non-steps

- No connection to Azure DEV in this planning task.
- No Cosmos documents written anywhere.
- No modifications to SQL records or re-run of the SQL batch.
- No new dependencies, no local emulator, no Docker install.
- No invented API endpoints or auth schemes.
- No business approval claimed.

## 9. Related docs

- `docs/COSMOS_DEV_READINESS.md` — integration points, R-01…R-16, prerequisites, blockers.
- `docs/UAT_RULE_TRACEABILITY.md` — SQL rule traceability (not Cosmos, but useful cross-reference for shared status/source pipeline).
- `docs/UAT_EXCLUSION_NOTES.md` — SQL UAT exclusion log framework.
- `docs/UAT_CLOSURE_REPORT.md` — SQL UAT closure, chain narrative.

Data Mapping baseline: **13 October 2026, 12:00 PM WIB**. HEAD: `4ad0811`.
