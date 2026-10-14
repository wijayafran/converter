# UAT Rule Traceability — Qonex → `dev_analytic_cxlite.analytic_leads_sales`

| Scope | Value |
| --- | --- |
| **Data Mapping baseline** | **13 October 2026, 12:00 PM WIB** |
| UAT execution date | 14 October 2026 |
| Repository HEAD | `62fb46d96b36754fb0661bcd9b3b0528dfcd64a7` (`62fb46d`) |
| Branch | `main` (local, not pushed) |
| Automated tests at HEAD | **131 / 131 PASS** |
| SQL rows after UAT | 14 (12 UAT + 2 earlier POC) |
| `eventlog` rows | 0 |

> Dokumen ini bersifat traceability engineering — menunjukkan **letak implementasi** setiap aturan.  
> **Lulus 131 unit test ≠ persetujuan bisnis.** Status approval tetap mengikuti kolom "Business approval" di tabel.

## Legend

| Verification | Arti |
| --- | --- |
| ✅ Implemented + tested | Kode ada, test regresi mem-pin perilaku |
| ⚠️ Implemented, not independently tested | Kode ada tapi belum ada test regresi khusus |
| 🔒 Blocking by design | Baris akan BLOCKED di validasi; tidak dapat di-approve massal |

| Business approval | Arti |
| --- | --- |
| ✅ Approved by Excel baseline | Tercantum eksplisit di Data Mapping Excel 13-Okt-2026 12:00 WIB |
| 🟡 Technical POC default | Keputusan engineering untuk POC lokal; menunggu konfirmasi bisnis |
| 🟡 Pending Ecovia confirmation | Mapping sudah di-flag ke bisnis, menunggu jawaban formal |
| 🔧 Technical transformation | Normalisasi engineering (bukan business rule) |

---

## 1. Identifiers & PK

| Rule ID | Target field | Qonex source | Expected rule | Implementation | Source file | Line range | Test file | Test line range | Verification | Business approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-ID-01 | `id` (PK) | `nomor_telepon` | WA_MOBILE identifier (konvensi `wa_<digitsPhone>`), prefix configurable | `const id = parentWa ?? …`; prefix via `ctx.waMobilePrefix` | `src/lib/transform/sql-generator.ts` | 339–346 | `src/__tests__/sql-generator.test.ts` | 143–154 | ✅ Implemented + tested | 🟡 Technical POC default — exact WA_MOBILE spelling pending final Excel column |
| R-ID-02 | `id` collision guard | — | Duplicate phone → duplicate PK → BLOCKED | `seenPkIds` map + `duplicate-id` blocker | `src/lib/transform/sql-generator.ts` | 78–120 | `src/__tests__/sql-generator.test.ts` + `src/__tests__/phase-2c.test.ts` | sql: 206–216; 2c: 125–138 | 🔒 Blocking by design | 🔧 Technical transformation |
| R-ID-03 | `leads_id` | — | New UUIDv4 per Qonex lead (stable across re-runs) | `stableUuid('cxlite-sql:' + legacyId)` | `src/lib/transform/sql-generator.ts` | 338–339 | `src/__tests__/sql-generator.test.ts` | 66–70 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-ID-04 | `leads_parent_id` | `nomor_telepon` | WA_MOBILE identifier (same convention as PK) | `waMobileId(phoneResult, ctx.waMobilePrefix)` | `src/lib/transform/sql-generator.ts` | 188 (compute), 362 (write) | `src/__tests__/sql-generator.test.ts` | 50–54 | ✅ Implemented + tested | 🟡 Technical POC default |

## 2. Qonex source normalization

| Rule ID | Target field | Qonex source | Expected rule | Implementation | Source file | Line range | Test file | Test line range | Verification | Business approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-SRC-01 | `leads_source` (approved values) | `source_data` | Approved CXLite enum canonicalised (`Ads`, `Referral`, …) | `SOURCE_APPROVED_LOOKUP` | `src/config/status-taxonomy.ts` | 266–299 | `src/__tests__/status-pipeline.test.ts` | 191–197, 236–246 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-SRC-02 | `leads_source` (pending canonicals) | `source_data` | Preserve raw Qonex value verbatim; proposed canonical to metadata only | `pending` branch sets `canonical=trimmed`, writes `proposedCanonical` | `src/config/status-taxonomy.ts` | 302–325, 396–407 | `src/__tests__/status-pipeline.test.ts` + `src/__tests__/phase-2c.test.ts` | pipeline: 172–200, 207–234; 2c: 69–81 | ✅ Implemented + tested | 🟡 Pending Ecovia confirmation (Rumah123, SML Website, Website Ecovia, Official - FB IG Ads Form) |
| R-SRC-03 | `leads_source` (truly unknown) | `source_data` | Preserve raw; emit WARNING `unknown-source` | `pending`/unknown branches | `src/config/status-taxonomy.ts` | 408–418 | `src/__tests__/status-pipeline.test.ts` + `src/__tests__/phase-2c.test.ts` | pipeline: 201–208; 2c: 84–89 | ✅ Implemented + tested | 🔧 Technical transformation |
| R-SRC-04 | `leads_channel` | `source_data` | `UPPER(leads_source)` | `sourceForColumn ? sourceForColumn.toUpperCase() : null` | `src/lib/transform/sql-generator.ts` | 353–361 | `src/__tests__/sql-generator.test.ts` + `src/__tests__/status-pipeline.test.ts` | sql: 37–42; pipeline: 213–231 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-SRC-05 | `leads_parent_channel` | — | Constant `"ONLINE"` | `PARTENT_CHANNEL = 'ONLINE'` | `src/lib/transform/sql-generator.ts` | 45 (const), 360 (write) | `src/__tests__/sql-generator.test.ts` | 37–42 | ✅ Implemented + tested | ✅ Approved by Excel baseline |

## 3. Status pipeline (shared Qonex → SQL)

| Rule ID | Target field | Qonex source | Expected rule | Implementation | Source file | Line range | Test file | Test line range | Verification | Business approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-STAT-01 | `resolveQonexStatus()` pipeline | `status` | Satu panggilan → canonical, UPPER, FSM group | Full `resolveQonexStatus` | `src/config/status-taxonomy.ts` | 116–167 | `src/__tests__/status-pipeline.test.ts` | 21–105 | ✅ Implemented + tested | 🔧 Technical transformation (consolidates approved rules below) |
| R-STAT-02 | `leads_status` | `status` | `UPPER(canonical)` | `statusInfo.upper` | `src/lib/transform/sql-generator.ts` | 365 | `src/__tests__/sql-generator.test.ts` + `src/__tests__/status-pipeline.test.ts` | sql: 56–64; pipeline: 108–131 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-STAT-03 | `leads_group_status` | `status` | FSM group NEW / FOLLOWUP / CLOSED; NULL when UNKNOWN/PENDING | `statusInfo.group === 'UNKNOWN' \|\| 'PENDING' ? null : statusInfo.group` | `src/lib/transform/sql-generator.ts` | 364 | `src/__tests__/sql-generator.test.ts` + `src/__tests__/status-pipeline.test.ts` | sql: 56–64; pipeline: 108–131 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-STAT-04 | Send Brochure | `status` | → `In Discussion` / FOLLOWUP | `SQL_STATUS_RESOLUTIONS['SEND BROCHURE']` | `src/config/status-taxonomy.ts` | 83 | `src/__tests__/status-pipeline.test.ts` | 22–32, 111–131 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-STAT-05 | Negotiation Process | `status` | → `In Discussion` / FOLLOWUP | `SQL_STATUS_RESOLUTIONS['NEGOTIATION PROCESS']` | `src/config/status-taxonomy.ts` | 84 | `src/__tests__/status-pipeline.test.ts` | 22–32, 111–131 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-STAT-06 | Schedule Site Visit | `status` | → `Site Visit` / FOLLOWUP | `SQL_STATUS_RESOLUTIONS['SCHEDULE SITE VISIT']` | `src/config/status-taxonomy.ts` | 85 | `src/__tests__/status-pipeline.test.ts` | 22–32, 111–131 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-STAT-07 | Send Price Simulation | `status` | → `In Discussion` / FOLLOWUP | `SQL_STATUS_RESOLUTIONS['SEND PRICE SIMULATION']` | `src/config/status-taxonomy.ts` | 86 | `src/__tests__/status-pipeline.test.ts` | 22–32, 111–131 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-STAT-08 | Site Visit With Client | `status` | → `Site Visit` / FOLLOWUP | `SQL_STATUS_RESOLUTIONS['SITE VISIT WITH CLIENT']` | `src/config/status-taxonomy.ts` | 87 | `src/__tests__/status-pipeline.test.ts` | 22–32, 111–131 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-STAT-09 | Booking Fee Received | `status` | → `Won` / CLOSED | `SQL_STATUS_RESOLUTIONS['BOOKING FEE RECEIVED']` | `src/config/status-taxonomy.ts` | 88 | `src/__tests__/status-pipeline.test.ts` | 22–32, 111–131 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-STAT-10 | Drop/Lost Opportunity | `status` | → `Cancelled` / CLOSED | `SQL_STATUS_RESOLUTIONS['DROP/LOST OPPORTUNITY']` + spelling variants | `src/config/status-taxonomy.ts` | 89–91 | `src/__tests__/status-pipeline.test.ts` | 22–32, 111–131 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-STAT-11 | **Send Pricelist** (blocker) | `status` | Preserve canonical `"Discussion"`; FSM group PENDING → row BLOCKED | `SQL_STATUS_PENDING['SEND PRICELIST']` + `pending-status-mapping` BLOCK | taxonomy: `src/config/status-taxonomy.ts`; generator: `src/lib/transform/sql-generator.ts` | taxonomy: 100–114; generator: 263–276 | `src/__tests__/status-pipeline.test.ts` | 46–57, 133–145 | 🔒 Blocking by design | 🟡 Pending Ecovia confirmation (FSM group) |
| R-STAT-12 | **Follow Up Leads** (blocker) | `status` | Canonical & FSM both pending → row BLOCKED | `SQL_STATUS_PENDING['FOLLOW UP LEADS']` + `pending-status-mapping` BLOCK | taxonomy: `src/config/status-taxonomy.ts`; generator: `src/lib/transform/sql-generator.ts` | taxonomy: 109–114; generator: 263–276 | `src/__tests__/status-pipeline.test.ts` | 59–66, 147–156 | 🔒 Blocking by design | 🟡 Pending Ecovia confirmation (canonical + FSM) |
| R-STAT-13 | Unresolved status (blocker) | `status` | No canonical → row BLOCKED (`unresolved-status`) | `statusInfo.group === 'UNKNOWN'` branch | `src/lib/transform/sql-generator.ts` | 249–262 | `src/__tests__/validation.test.ts` + `src/__tests__/status-pipeline.test.ts` | validation: 6–12; pipeline: 158–169 | 🔒 Blocking by design | 🔧 Technical transformation |

## 4. Phone + timezone + varchar

| Rule ID | Target field | Qonex source | Expected rule | Implementation | Source file | Line range | Test file | Test line range | Verification | Business approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-PHN-01 | Phone normalization | `nomor_telepon` | Normalisasi ke E.164 (`+62…`), tolak non-mobile / terlalu pendek | `normalizePhone()` | `src/lib/transform/primitives.ts` | 50–89 | `src/__tests__/primitives.test.ts` | 16–45 | ✅ Implemented + tested | 🔧 Technical transformation |
| R-PHN-02 | `leads_customer_phone` | `nomor_telepon` | Digits-only `62…` (tanpa `+`) | `digitsPhone()` + record write | primitives: `src/lib/transform/primitives.ts`; generator: `src/lib/transform/sql-generator.ts` | primitives: 105–108; generator: 386 | `src/__tests__/sql-generator.test.ts` | 44–47 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-TZ-01 | `leads_created_on` | `create` | ISO 8601 UTC dari waktu wall-clock Jakarta | `parseDate()` + `createDate.utcIso` | primitives: `src/lib/transform/primitives.ts`; generator: `src/lib/transform/sql-generator.ts` | primitives: 188–230; generator: 348, 371 | `src/__tests__/primitives.test.ts` + `src/__tests__/phase-2d.test.ts` | primitives: 69–96; 2d: 114–126 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-TZ-02 | `leads_changed_on` | `last_update` | ISO 8601 UTC dari waktu wall-clock Jakarta | `parseDate()` + `updatedDate.utcIso` | `src/lib/transform/sql-generator.ts` | 349, 371 | `src/__tests__/phase-2d.test.ts` | 114–126 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-TZ-03 | `event_time` | `last_update` | Mirror of `leads_changed_on` (NULL ketika source blank) | `event_time: changedOnUtc` | `src/lib/transform/sql-generator.ts` | 358 | `src/__tests__/sql-generator.test.ts` | 189–204 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-VARCHAR-01 | `leads_note` ≤ 2000 | `keterangan` | > 2000 chars → BLOCK (no silent truncation) | `noteOverflow` check | `src/lib/transform/sql-generator.ts` | 184–185, 284–297, 379 | `src/__tests__/sql-generator.test.ts` | 95–107 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-VARCHAR-02 | Generic varchar overflow | — | Any varchar(N) overflow → BLOCK, original preserved on issue | Loop at 417–436 | `src/lib/transform/sql-generator.ts` | 417–436 | `src/__tests__/phase-2c.test.ts` | — (covered indirectly via sales_rep length) | ⚠️ Implemented, not independently tested | 🔧 Technical transformation |

## 5. NULL / default values (per revised Excel 13-Okt-2026)

| Rule ID | Target field | Expected rule | Implementation | Source file | Line range | Test file | Test line range | Verification | Business approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-NULL-01 | `leads_urgency` | NULL (previously invented `"Medium"`) | `leads_urgency: null` | `src/lib/transform/sql-generator.ts` | 394 | `src/__tests__/phase-2c.test.ts` | 14–17 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-NULL-02 | `leads_qualification_level` | NULL (no Qonex analogue) | `leads_qualification_level: null` | `src/lib/transform/sql-generator.ts` | 382 | `src/__tests__/phase-2c.test.ts` | 20–26 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-NULL-03 | `leads_assigned_by` | NULL (migration-marker policy pending) | `leads_assigned_by: null` | `src/lib/transform/sql-generator.ts` | 376 | `src/__tests__/phase-2c.test.ts` | 20–26 | ✅ Implemented + tested | 🟡 Pending Ecovia confirmation |
| R-NULL-04 | `sales_manager_name` | NULL (mirror of `leads_assigned_by`) | `sales_manager_name: null` | `src/lib/transform/sql-generator.ts` | 406 | `src/__tests__/phase-2c.test.ts` | 20–26 | ✅ Implemented + tested | 🟡 Pending Ecovia confirmation |
| R-NULL-05 | `leads_company` | NULL (pending Ecovia company mapping) | `leads_company: null` | `src/lib/transform/sql-generator.ts` | 378 | `src/__tests__/phase-2c.test.ts` | 20–26 | ✅ Implemented + tested | 🟡 Pending Ecovia confirmation |
| R-NULL-06 | `leads_project` | NULL (pending Ecovia project mapping) | `leads_project: null` | `src/lib/transform/sql-generator.ts` | 390 | `src/__tests__/phase-2c.test.ts` | 20–26 | ✅ Implemented + tested | 🟡 Pending Ecovia confirmation |
| R-NULL-07 | `eventlog_id` | NULL (POC leaves eventlog empty) | `eventlog_id: null` | `src/lib/transform/sql-generator.ts` | 356 | `src/__tests__/phase-2c.test.ts` | 36–42 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-NULL-08 | `event_name` | NULL (POC does not synthesise event taxonomy) | `event_name: null` | `src/lib/transform/sql-generator.ts` | 357 | `src/__tests__/phase-2c.test.ts` | 36–42 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-NULL-09 | `leads_customer_ktp` | `""` on SQL rows (KTP is Cosmos Won-only) | `leads_customer_ktp: ''` | `src/lib/transform/sql-generator.ts` | 388 | — | — | ⚠️ Implemented, not independently tested | ✅ Approved by Excel baseline |
| R-DEF-01 | `leads_created_by` | Constant `"DataMigration01"` | `DATA_MIGRATION_USER` const | `src/lib/transform/sql-generator.ts` | 48 (const), 372 (write) | `src/__tests__/sql-generator.test.ts` + `src/__tests__/phase-2c.test.ts` | sql: 83–88; 2c: 29–33 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-DEF-02 | `leads_aging` | `0` (snapshot-only POC) | `leads_aging: 0` | `src/lib/transform/sql-generator.ts` | 399 | `src/__tests__/sql-generator.test.ts` + `src/__tests__/phase-2c.test.ts` | sql: 72–81; 2c: 36–42 | ✅ Implemented + tested | ✅ Approved by Excel baseline (initial snapshot) |
| R-DEF-03 | `created_by` / `updated_by` | Default `"system-batch"`; configurable `rowProvenanceUser` | `provenanceUser` from `ctx.rowProvenanceUser` | `src/lib/transform/sql-generator.ts` | 42, 65–68, 78–79, 351, 410, 412 | `src/__tests__/sql-generator.test.ts` + `src/__tests__/phase-2c.test.ts` | sql: 265–268 (indirect); 2c: 60–66 (indirect) | ✅ Implemented + tested | 🟡 Pending Ecovia confirmation (Excel proposes `"DataMigration01"`) |
| R-DEF-04 | `leads_total_score`, `leads_property_price` | `0` placeholders | Record writes `0` | `src/lib/transform/sql-generator.ts` | 368, 395 | `src/__tests__/sql-generator.test.ts` | 72–81 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-DEF-05 | `leads_raw_score`, `leads_raw_property` | `"{}"` placeholders | Record writes `'{}'` | `src/lib/transform/sql-generator.ts` | 369, 396 | `src/__tests__/sql-generator.test.ts` | 72–81 | ✅ Implemented + tested | ✅ Approved by Excel baseline |
| R-DEF-06 | `sales_name` | Mirror `leads_assigned_to` (= Qonex `sales_rep`) | `sales_name: salesRep` | `src/lib/transform/sql-generator.ts` | 402 | — | — | ⚠️ Implemented, not independently tested | ✅ Approved by Excel baseline |

## 6. sales_rep preservation (no invented cleaning rule)

| Rule ID | Target field | Qonex source | Expected rule | Implementation | Source file | Line range | Test file | Test line range | Verification | Business approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-SR-01 | `leads_assigned_to`, `sales_name` | `sales_rep` | `trimString(raw)` saja — tidak ada cleaning untuk `(inactive)` dsb | `trimString(row['sales_rep'])` | `src/lib/transform/sql-generator.ts` | 177 (compute), 373, 402 (write) | `src/__tests__/phase-2c.test.ts` | 48–66 | ✅ Implemented + tested | ✅ Approved by Excel baseline (no cleanup rule approved) |

## 7. 51-column SQL generator

| Rule ID | Target feature | Expected rule | Implementation | Source file | Line range | Test file | Test line range | Verification | Business approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-SCHEMA-01 | `analytic_leads_sales` schema list | 51 kolom dalam urutan DDL otoritatif | `SQL_ANALYTIC_LEADS_SALES_COLUMNS` array + load-time length assertion | `src/config/sql-mapping.ts` | 32–84 (array), 86–89 (assertion) | `src/__tests__/sql-generator.test.ts` + `src/__tests__/phase-2c.test.ts` | sql: 14–23; 2c: 115–123 | ✅ Implemented + tested | ✅ Approved (verbatim dari `analytics-sqlserver-lemons.md`) |
| R-SCHEMA-02 | `transformToSqlRecords` output shape | Setiap record berisi 51 kolom dalam urutan DDL | Record literal + post-loop column walk | `src/lib/transform/sql-generator.ts` | 354–415 (literal), 417–450 (walk) | `src/__tests__/sql-generator.test.ts` | 14–23 | ✅ Implemented + tested | ✅ Approved by Excel baseline |

## 8. Excluded-row filtering

| Rule ID | Target workflow | Expected rule | Implementation | Source file | Line range | Test file | Test line range | Verification | Business approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-EXCL-01 | `decideIssue` → exclusion flag | User-triggered row exclusion attached to issue | `issues.map((i) => i.id === id ? { ...i, decision } : i)` | `src/state/workflow-store.ts` | 159–163 | `src/__tests__/phase-2d.test.ts` | 34–71 (indirect via 16/4/12 chain) | ✅ Implemented + tested | 🔧 Technical transformation |
| R-EXCL-02 | Batch payload filter | Excluded rows do NOT enter batch | `excludedRowSet` built from issue decisions; filter applied before `createBatchRunner` | `src/state/workflow-store.ts` | 193–211, 247–253 | `src/__tests__/phase-2d.test.ts` | 34–71, 129–167 | ✅ Implemented + tested | 🔧 Technical transformation |
| R-EXCL-03 | Preview payload filter | Preview display filters by same `excludedRowSet` | `wrappers.filter((r) => !r.blocked && !excludedRows.has(r.rowIndex))` | `src/components/wizard/steps/PreviewStep.tsx` | 53–83 | `src/__tests__/phase-2d.test.ts` | 34–71 | ✅ Implemented + tested | 🔧 Technical transformation |

## 9. Preview pagination + payload consistency

| Rule ID | Target workflow | Expected rule | Implementation | Source file | Line range | Test file | Test line range | Verification | Business approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-UI-01 | Preview pagination | 10 / 25 / 50 / All page sizes, Prev/Next, counter | `pageSize` state + `rows.slice(start, end)` | `src/components/shared/SqlPreview.tsx` | 23–41, 55–75, 108–144 | `src/__tests__/phase-2d.test.ts` | 45–59 | ✅ Implemented + tested | 🔧 Technical transformation |
| R-UI-02 | Pagination affects display only | Download + batch use full eligible list regardless of page | Preview reads full `sqlOutput.records`; `downloadJson` + batch use the full set | `src/components/wizard/steps/PreviewStep.tsx` | 69–83, 334–351 (download); store 193–224 (batch) | `src/__tests__/phase-2d.test.ts` | 61–71 | ✅ Implemented + tested | 🔧 Technical transformation |
| R-PAYLOAD-01 | Prepared payload (shared records) | Preview, download, batch share the exact SqlRecord references | Preview reads `validation.sqlResult.records`; store reads same in `simulateMigration` | `src/components/wizard/steps/PreviewStep.tsx` + `src/state/workflow-store.ts` | preview: 69–83; store: 199–224 | `src/__tests__/phase-2d.test.ts` | 73–127 | ✅ Implemented + tested | 🔧 Technical transformation |
| R-PAYLOAD-02 | Timestamp stability | `created_at` / `updated_at` stable across the prepared run | Single `now` on `TransformContext`; validation seals it | `src/lib/transform/sql-generator.ts` | 75–81, 349, 409–413 | `src/__tests__/phase-2d.test.ts` | 75–127 | ✅ Implemented + tested | 🔧 Technical transformation |
| R-PAYLOAD-03 | Explicit regeneration | Mapping / source / exclude changes invalidate the prepared payload | `setParsedFile` and `updateMapping` clear `validation` / `issues` / `result` | `src/state/workflow-store.ts` | 108–137 | — | — | ⚠️ Implemented, not independently tested | 🔧 Technical transformation |

## 10. SQL insert + read-back (LIVE path)

| Rule ID | Target workflow | Expected rule | Implementation | Source file | Line range | Test file | Test line range | Verification | Business approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-SQL-01 | `/api/sql/validate-connection` | `SELECT @@VERSION` from local SQL container | `pool.request().query('SELECT @@VERSION AS v')` | `server/sql-adapter.ts` | 85–102 | — (manual via `verify:sql`) | — | ⚠️ Implemented, exercised by `scripts/verify-sql.ts` | 🔧 Technical transformation |
| R-SQL-02 | `/api/sql/apply-ddl` | Verbatim DDL (`SQL_DDL.eventlog`, `SQL_DDL.analyticLeadsSales`) applied, no-op if present | `pool.request().batch(SQL_DDL.*)` | `server/sql-adapter.ts` | 62–66 | — (manual) | — | ⚠️ Implemented, exercised by `scripts/poc-sql.ts` | ✅ Approved by Excel baseline |
| R-SQL-03 | `/api/sql/execute-batch` → `insertBatch` | Parameterised `INSERT` per row; PK violation (2627) → `conflict` | mssql pool `request.input` + `query` | `server/sql-adapter.ts` | 118–157 | `src/__tests__/batch.test.ts` + `src/__tests__/phase-2d.test.ts` | batch: full file; 2d: 129–167 | ✅ Implemented + tested (MOCK + LIVE smoke) | 🔧 Technical transformation |
| R-SQL-04 | Read-back verification | SELECT ids inserted; mismatch → `missingHashes` | `verifyInsertedRecords` → `STRING_SPLIT` IN clause | `server/sql-adapter.ts` | 176–187 | `src/__tests__/phase-2d.test.ts` | 194–221 | ✅ Implemented + tested | 🔧 Technical transformation |
| R-SQL-05 | `verifyIfLive` (store) | Only runs for LIVE; counts verified per batch | `verifyIfLive` function | `src/state/workflow-store.ts` | 294–317 | `src/__tests__/phase-2d.test.ts` | 131–167 | ✅ Implemented + tested | 🔧 Technical transformation |
| R-SQL-06 | HTTP SQL adapter (browser) | Proxies to backend; secrets stay server-side | `createHttpSqlAdapter` | `src/lib/adapters/http-sql-adapter.ts` | 34–120 | `scripts/smoke-http-sql.ts` | — | ⚠️ Implemented, exercised by smoke script | 🔧 Technical transformation |

## 11. Migration result counts

| Rule ID | Target feature | Expected rule | Implementation | Source file | Line range | Test file | Test line range | Verification | Business approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-COUNT-01 | `MigrationResultCounts` shape | source, excluded, blocked, eligible, attempted, inserted, skipped, failed, conflicts, verified | Type declaration | `src/types/index.ts` | 83–112 | — | — | ⚠️ Type-only | 🔧 Technical transformation |
| R-COUNT-02 | LIVE "successful" = verified | `successful = verified ?? inserted` in LIVE; `0` in DRY_RUN | `successfulReported` | `src/state/workflow-store.ts` | 353–363 | `src/__tests__/phase-2d.test.ts` | 131–167, 225–244 | ✅ Implemented + tested | 🔧 Technical transformation |
| R-COUNT-03 | Chain consistency warning | Attempted ≠ inserted + skipped + failed + conflicts → warning banner | `chainConsistent` check | `src/components/shared/MigrationResult.tsx` | 118–122, 165–176 | — | — | ⚠️ Implemented, UI-only | 🔧 Technical transformation |
| R-COUNT-04 | Mode label | `SQL Local Test` / `Dry Run — No Database Writes` / `Cosmos DEV — Pending Integration` | `modeFor()` + render | store: `src/state/workflow-store.ts`; UI: `src/components/shared/MigrationResult.tsx` | store: 335–345; UI: 123–146 | — | — | ⚠️ Implemented, UI-only | 🔧 Technical transformation |
| R-COUNT-05 | DRY_RUN never reports inserts | `successfulReported = 0` in DRY_RUN | Same `successfulReported` branch | `src/state/workflow-store.ts` | 358–363 | `src/__tests__/phase-2d.test.ts` | 227–244 | ✅ Implemented + tested | 🔧 Technical transformation |
| R-COUNT-06 | Attribution comes from current run only | `batches: manifest.batches.map(...)`; no DB query to claim rows | `batches` + `insertedIds` built from `manifest.batches[i].adapterResult.perRecord` | `src/state/workflow-store.ts` | 380–397 | — | — | ⚠️ Implemented, by inspection | 🔧 Technical transformation |

---

## Pending items (business decisions outstanding)

These rules are implemented but **not yet approved** by stakeholders. The implementation deliberately defers decision:

1. **R-SRC-02** — Pending canonical for Rumah123 / SML Website / Website Ecovia / Official - FB IG Ads Form.
2. **R-STAT-11** — FSM group for `Send Pricelist` ("Discussion").
3. **R-STAT-12** — Canonical + FSM group for `Follow Up Leads`.
4. **R-NULL-03 / R-NULL-04** — Migration-marker policy for `leads_assigned_by` / `sales_manager_name`.
5. **R-NULL-05 / R-NULL-06** — `leads_company` and `leads_project` mapping.
6. **R-DEF-03** — Final value for `created_by` / `updated_by` (Excel proposes `"DataMigration01"`).
7. `sales_rep` cleanup rule (`(inactive)` suffix) — not implemented; raw preserved.

## Missing automated test coverage (gaps)

| Rule | Gap |
| --- | --- |
| R-VARCHAR-02 | Generic varchar overflow BLOCK path is covered indirectly only. |
| R-NULL-09 | No direct assertion on `leads_customer_ktp = ''`. |
| R-DEF-06 | No direct assertion on `sales_name` mirroring. |
| R-PAYLOAD-03 | Store-level invalidation on mapping/source change has no automated test (would need React-level test). |
| R-COUNT-01 / R-COUNT-03 / R-COUNT-04 / R-COUNT-06 | UI reporting shapes are not directly asserted (would need UI tests). |
| R-SQL-01 / R-SQL-02 / R-SQL-06 | Backend LIVE paths covered by manual smoke scripts, not vitest. |

These gaps are safe for the current POC because every affected area is still exercised by at least one adjacent test or manual smoke, but they should be filled before promoting past local SQL UAT.

## Commit log (relevant commits at HEAD)

```
62fb46d feat(phase-2d): preview pagination, timestamp stability, full count chain
12fb7e2 feat(phase-2c): Excel-driven SQL mapping alignment
fe60606 fix(sql-mapping): unified Qonex→SQL status pipeline + UAT mappings
def1cf6 fix(sql-mapping): round-2 audit — NULL pending-Ecovia fields + no-silent-truncation
3cb8f71 fix(sql-mapping): align UI + generator to revised Qonex→analytic mapping
9079c98 fix(backend): auto-load .env + vite /api proxy + diagnose script
2888b5c feat(phase-2b): HTTP SQL adapter + UI opt-in + Cosmos local disabled
8ca791d feat(phase-2b): rebuild SQL/Cosmos against authoritative specs + local backend
a0eeb87 chore(phase-2a): migration tool complete — transformers, adapters, batch, tests
```

Data Mapping baseline: **13 October 2026, 12:00 PM WIB**. HEAD: `62fb46d`.
