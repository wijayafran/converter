# UAT Closure Report — SQL Server Local, 14 October 2026

| Scope | Value |
| --- | --- |
| **Data Mapping baseline** | **13 October 2026, 12:00 PM WIB** |
| UAT execution date | 14 October 2026 |
| Target destination | `dev_analytic_cxlite.analytic_leads_sales` (SQL Local Test container `lemons-mssql`) |
| Repository HEAD | `62fb46d96b36754fb0661bcd9b3b0528dfcd64a7` (`62fb46d`) |
| Branch | `main` (local only — not pushed) |
| Automated tests at HEAD | **131 / 131 PASS** (vitest) |
| TypeScript / Lint / Build | clean |
| Non-destructive `verify:sql` | 7 / 7 PASS (row_count=14, eventlog=0) |

> **Catatan penting**: 131 unit test yang lulus **bukan** bentuk persetujuan bisnis. Approval tetap mengacu pada Data Mapping Excel tanggal 13 Oktober 2026 pukul 12:00 WIB dan tanda tangan stakeholder.

## 1. Ringkasan hasil UAT

```
source     = 16
blocked    = 4   (validation blocker on Excel rows 4, 7, 13, 16)
excluded   = 4   (same rows — tester deliberately excluded in Review)
eligible   = 12  (16 − union(blocked, excluded) = 16 − 4)
attempted  = 12
inserted   = 12
verified   = 12  (read-back via SELECT)
failed     = 0
conflicts  = 0
```

Catatan atribusi: `blocked` dan `excluded` dilaporkan terpisah di UI karena kedua jalur safety aktif pada baris yang sama. Keempat baris (4, 7, 13, 16) **ditandai BLOCKED oleh validasi** (misalnya `unresolved-status`, `pending-status-mapping`, `destination-constraint`); tester kemudian **mengecualikan secara sengaja** di langkah Review (`issues[].decision = 'exclude'`). Keduanya sama-sama membuang baris dari `eligible`, sehingga baris tidak dikirim ke batch runner dan tidak muncul di database.

Chain konsisten: `attempted (12) = inserted (12) + skipped (0) + failed (0) + conflicts (0)` dan `verified (12) = inserted (12)` → tidak ada chain-inconsistency banner.

Database setelah UAT: **14 baris** di `analytic_leads_sales` (12 UAT + 2 earlier POC rows). Tabel `eventlog` **tetap 0 baris** sesuai invariant POC.

## 2. Scope yang di-cover

| Area | Status | Catatan |
| --- | --- | --- |
| 51-column schema (per authoritative DDL) | ✅ | `verify:sql` memastikan column names & types match `analytics-sqlserver-lemons.md` byte-for-byte |
| WA_MOBILE PK (`id`) + collision guard | ✅ | Prefix configurable; duplicate phone → BLOCKED pre-insert |
| `leads_source` raw preservation | ✅ | Pending canonicals (Rumah123/SML Website/Website Ecovia/Official FB IG Ads) **tidak** di-promote diam-diam |
| `leads_channel = UPPER(leads_source)` | ✅ | Mengikuti source yang dipreserve |
| Status pipeline (satu `resolveQonexStatus`) | ✅ | 7 approved mappings + 2 pending blockers (`Send Pricelist`, `Follow Up Leads`) |
| Phone normalization | ✅ | Indonesian E.164; invalid phones ditolak sebagai WARNING |
| Timezone (Jakarta → UTC) | ✅ | `leads_created_on` / `leads_changed_on` / `event_time` UTC-sourced |
| Timestamp stability (preview = download = batch) | ✅ | Satu `now` per prepared run; invalidasi eksplisit pada perubahan input |
| NULL defaults (urgency / qualification / assigned_by / sales_manager_name / company / project) | ✅ | Per revised Excel |
| `leads_created_by = "DataMigration01"` | ✅ | Approved constant |
| `leads_aging = 0` | ✅ | Initial-snapshot POC |
| `eventlog_id = NULL`, `event_name = NULL`, eventlog table untouched | ✅ | Verified non-destructively |
| Excluded-row filtering (user decision) | ✅ | 4 baris dikecualikan — tidak masuk payload |
| Preview pagination (10 / 25 / 50 / All) | ✅ | Display-only; payload selalu full eligible set |
| LIVE insert + read-back verification | ✅ | `verified` = metric sukses, bukan `inserted` |
| Attribution dari run saat ini | ✅ | Tidak meng-claim row DB yang berasal dari run lain |

## 3. Scope yang **belum** approved (menunggu stakeholder)

Lihat `UAT_RULE_TRACEABILITY.md` kolom "Business approval" untuk rincian lengkap. Ringkasan item yang masih 🟡:

1. **Qonex source → CXLite canonical** untuk nilai pending (Rumah123, SML Website, Website Ecovia, Official - FB IG Ads Form).  
   *Engine behaviour saat ini*: preserve raw; proposed canonical ditampilkan sebagai metadata di issue report.
2. **FSM group untuk `Send Pricelist` ("Discussion")**.  
   *Engine behaviour*: canonical dipertahankan; baris di-BLOCK (`pending-status-mapping`).
3. **Canonical + FSM untuk `Follow Up Leads`**.  
   *Engine behaviour*: raw dipertahankan; baris di-BLOCK.
4. **Policy migration-marker untuk `leads_assigned_by` dan `sales_manager_name`**.  
   *Engine behaviour*: NULL.
5. **Mapping `leads_company` dan `leads_project`**.  
   *Engine behaviour*: NULL.
6. **Nilai final `created_by` / `updated_by`**. Migration Excel mengusulkan `"DataMigration01"`.  
   *Engine behaviour*: default `"system-batch"`, configurable via `rowProvenanceUser`.
7. **Aturan cleanup `sales_rep` ("(inactive)" + tanggal)**.  
   *Engine behaviour*: raw dipertahankan verbatim; tidak ada aturan yang di-invent.
8. **Lemon Vireya API contract + Azure DEV Cosmos credentials** (tidak termasuk SQL UAT ini, tetap tercantum untuk completeness).

## 4. Missing evidence / gaps

| Area | Gap | Risk | Mitigation |
| --- | --- | --- | --- |
| Alasan bisnis per baris excluded (4, 7, 13, 16) | Belum diisi di `UAT_EXCLUSION_NOTES.md` | Audit tidak lengkap tanpa tanda tangan Data Analyst | Isi tabel di `UAT_EXCLUSION_NOTES.md` sebelum sign-off |
| Automated test untuk UI reporting shape (R-COUNT-01, R-COUNT-03/04/06) | UI dipakai manual, bukan unit-tested | Future refactor bisa mengubah tampilan hasil tanpa warning | Tambah UI test (React Testing Library) di Phase 3 |
| Automated test untuk `leads_customer_ktp = ''` (R-NULL-09) & `sales_name` mirror (R-DEF-06) | Perilaku di-pin oleh assertion kolom umum, tidak ada test khusus | Low — fields didukung oleh column-walk | Tambah assertion eksplisit saat test-regresi Phase 3 |
| Backend LIVE paths (R-SQL-01/02/06) | Hanya smoke script (`verify:sql`, `poc:sql`, `smoke:http-sql`), bukan vitest | Smoke scripts dependen pada container running | Pertahankan smoke scripts dalam CI runbook sebelum promote |
| Generic varchar overflow (R-VARCHAR-02) | Tidak ada test khusus di luar `leads_note` | Low — overflow path identik dengan `leads_note` | Tambah test minimal di sql-generator.test.ts |

## 5. Daftar perubahan sejak Data Mapping baseline (13 Oktober 2026)

| Commit | Judul | Terkait Data Mapping? |
| --- | --- | --- |
| `62fb46d` | Phase 2D — pagination, timestamp stability, full count chain | Technical (UI/UX + reporting); Data Mapping tidak terdampak |
| `12fb7e2` | Phase 2C — Excel-driven SQL mapping alignment (preserve raw source) | **Aligned to Data Mapping**: menghilangkan silent promotion ke proposed canonicals; set `leads_urgency = NULL` |
| `fe60606` | Unified Qonex→SQL status pipeline + UAT mappings | **Aligned to Data Mapping**: 7 approved status mappings + 2 pending blockers |
| `def1cf6` | NULL pending-Ecovia fields + no-silent-truncation | **Aligned to Data Mapping**: `leads_assigned_by`, `sales_manager_name`, `leads_qualification_level`, `leads_company`, `leads_project` → NULL; `leads_note` overflow → BLOCKED |
| `3cb8f71` | Align UI + generator to revised Qonex→analytic mapping | **Aligned to Data Mapping**: WA_MOBILE PK, `event_name=NULL`, `event_time` from `last_update`, `leads_created_by=DataMigration01` |
| `9079c98` | Backend auto-load .env + vite proxy + diagnose script | Technical infra |
| `2888b5c` | Phase 2B — HTTP SQL adapter + UI opt-in + Cosmos local disabled | Technical infra |
| `8ca791d` | Phase 2B — SQL/Cosmos rebuild against authoritative specs | **Baseline alignment** |
| `a0eeb87` | Phase 2A — initial migration tool | Pre-baseline (invented rules; superseded by later commits) |

## 6. Readiness assessment

| Readiness gate | Status |
| --- | --- |
| Data Mapping baseline rules implementable | ✅ (31 implemented, 7 pending — all explicitly flagged) |
| Pending mappings do NOT silently affect SQL output | ✅ (sources preserved; pending status blocks the row) |
| 51-column SQL output matches DDL | ✅ (`verify:sql` cross-checks types + lengths) |
| Preview = JSON download = SQL batch (identical records) | ✅ (shared `validation.sqlResult.records`) |
| Timestamps stable within a prepared run | ✅ |
| LIVE "successful" count = verified read-back | ✅ |
| Excluded rows cannot enter execution batch | ✅ |
| 14 existing SQL rows preserved | ✅ (non-destructive `verify:sql` reports row_count=14) |
| `eventlog` untouched (0 rows) | ✅ |
| No connection to Azure DEV / production | ✅ |
| Cosmos code frozen (Cosmos DEV pending) | ✅ |

**Recommendation**: Siap untuk sign-off UAT SQL Server Local 14-Okt-2026 **dengan catatan**:
- Baris excluded (4, 7, 13, 16) **masih memerlukan alasan bisnis tertulis** di `UAT_EXCLUSION_NOTES.md`.
- Mapping pending (lihat §3) perlu persetujuan Ecovia sebelum promote keluar Local Development.
- Tambahan test coverage di gap §4 disarankan sebelum Phase 3.

## 7. Deliverables index

| Dokumen | Lokasi |
| --- | --- |
| Traceability (rule → file:line → test) | `docs/UAT_RULE_TRACEABILITY.md` |
| Exclusion notes | `docs/UAT_EXCLUSION_NOTES.md` |
| This closure report | `docs/UAT_CLOSURE_REPORT.md` |
| Dry-run reconciliation tool (read-only) | `scripts/reconcile-dry-run.ts` |
| Non-destructive SQL verifier | `scripts/verify-sql.ts` |
| HTTP smoke test | `scripts/smoke-http-sql.ts` |

Data Mapping baseline: **13 October 2026, 12:00 PM WIB**. HEAD: `62fb46d`. Local only; not pushed.
