# UAT Exclusion Notes — SQL Local UAT 14 October 2026

| Scope | Value |
| --- | --- |
| **Data Mapping baseline** | **13 October 2026, 12:00 PM WIB** |
| UAT execution date | 14 October 2026 |
| Repository HEAD | `62fb46d` |
| Dataset | 16 synthetic Qonex rows |
| Rows BLOCKED by validation **and** EXCLUDED by tester | **4** · Excel row numbers **4, 7, 13, 16** |
| Eligible for migration | 12 |
| Inserted + read-back verified | 12 |

## Narrative

Keempat baris (4, 7, 13, 16) **diblokir oleh engine validasi** saat langkah Validation (`BlockingIssue` dipasang pada record — misalnya `unresolved-status`, `pending-status-mapping`, atau `destination-constraint`). Pada langkah Review, tester kemudian **mengecualikan secara sengaja** keempat baris tersebut (`issues[].decision = 'exclude'`), **sehingga tidak dikirim ke batch migrasi**.

Artinya kedua jalur safety aktif pada baris-baris ini:

1. **Validation BLOCK** — baris tidak akan dapat lolos filter `!r.blocked` meskipun tester lupa menandainya. Rujukan kode: `src/state/workflow-store.ts:207–211`.
2. **User EXCLUDE** — tester menandai eksklusi secara eksplisit; keputusan disimpan di `issues[].decision`. Rujukan kode: `src/state/workflow-store.ts:159–163`.

Keduanya sama-sama membuang baris dari `eligible`. Dokumen ini bukan pengganti persetujuan Excel — hanya mencatat atribusi teknis + alasan bisnis per baris.

> Catatan engineering: baris yang ditandai `exclude` tidak masuk ke batch runner.  
> Implementasi: `src/state/workflow-store.ts:193–211` (filter), `src/__tests__/phase-2d.test.ts:34–71` (regresi 16/4/12).

## Exclusion log

| # | Excel row | Qonex ID | Validation blocker category | Reason (business — Data Analyst sign-off) | Expected engine behaviour | Observed engine behaviour |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 4 | *(diisi dari log UAT)* | *(diisi — e.g. `unresolved-status` / `pending-status-mapping` / `destination-constraint`)* | *(diisi oleh Data Analyst)* | Baris memiliki `blockingIssues`; tester juga menandai `exclude`. Tidak masuk `eligible`; batch tidak mengirim baris ini | Row BLOCKED by validation **and** excluded by tester; manifest tidak memiliki `id` baris 4 |
| 2 | 7 | *(diisi)* | *(diisi)* | *(diisi)* | sama | sama |
| 3 | 13 | *(diisi)* | *(diisi)* | *(diisi)* | sama | sama |
| 4 | 16 | *(diisi)* | *(diisi)* | *(diisi)* | sama | sama |

> Tabel di atas menyediakan kerangka. Data Analyst mengisi `Qonex ID` dan `Reason` dari log UAT 14-Okt-2026, lalu menandatangani dokumen.

## Technical attribution

- Keputusan user tersimpan di store sebagai `issues[].decision`:  
  `src/state/workflow-store.ts:159–163` (`decideIssue`).
- `excludedRowSet` dibangun ulang setiap kali batch dijalankan:  
  `src/state/workflow-store.ts:193–195`.
- Filter diterapkan sebelum `createBatchRunner`:  
  `src/state/workflow-store.ts:207–211` (SQL) dan `247–253` (Cosmos — tidak dijalankan).
- Preview menerapkan filter yang sama agar preview = payload yang dieksekusi:  
  `src/components/wizard/steps/PreviewStep.tsx:69–83`.
- Hasil akhir mencatat `counts.excluded`:  
  `src/state/workflow-store.ts:366–376` (`toResultSummary`).

## Guarantees

1. **Exclusion tidak mengubah transformasi record lain**. Semua record di-transform satu kali oleh `runValidation()`; exclusion hanya memfilter saat konsumsi.
2. **Timestamp tetap stabil**. Exclusion tidak memicu regenerasi payload — `created_at` / `updated_at` tidak berubah pada record yang tersisa.  
   Pembuktian otomatis: `src/__tests__/phase-2d.test.ts:75–111`.
3. **Batch runner hanya menerima eligible records**. Tidak ada jalur dalam `simulateMigration` yang mengirim baris excluded ke adapter.  
   Lihat `src/state/workflow-store.ts:207–224`.
4. **Hasil UAT (chain)**  
   `source=16 · blocked=4 (validation) · excluded=4 (tester) · eligible=12 · attempted=12 · inserted=12 · verified=12`.  
   `blocked` dan `excluded` dilaporkan terpisah di UI karena kedua filter dapat aktif bersamaan pada baris yang sama; `eligible` adalah hasil akhir setelah membuang baris yang masuk salah satu (atau keduanya).

## Business approval

| Item | Status |
| --- | --- |
| Daftar baris excluded dicatat di `issues[].decision` | ✅ Technical |
| Validation blocker tercatat per baris (category + field) | ⏳ **Awaiting log from UAT session** (fill in the table above) |
| Alasan bisnis untuk setiap baris excluded | ⏳ **Awaiting Data Analyst sign-off** (fill in the table above) |
| Konfirmasi excluded rows tidak dimigrasikan | ✅ Technical (`verify:sql` row_count = 14 = 12 UAT + 2 earlier POC; tidak ada 16) |

Data Mapping baseline: **13 October 2026, 12:00 PM WIB**. HEAD: `62fb46d`.
