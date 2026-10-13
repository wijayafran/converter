/**
 * Backwards-compatible facade over the modular transform engine.
 *
 * The current wizard UI imports `transformToLemon`, `transformToSqlRows`,
 * and `buildSqlPreviewStatement` from this file. The real implementations
 * now live in `./transform/`; this shim keeps the UI compiling while we
 * migrate call sites to the richer API.
 */

import type { ParsedFile } from '@/types'
import {
  transformToCosmos,
  type CosmosLeadDocument,
  type CosmosTransformOptions,
} from './transform/cosmos-generator'
import {
  transformToSqlRecords,
  buildSqlPreviewStatement as buildSqlPreviewStatementImpl,
  type SqlRecord,
  type SqlTransformOptions,
} from './transform/sql-generator'

export function transformToLemon(
  parsed: ParsedFile,
  options?: CosmosTransformOptions,
): CosmosLeadDocument[] {
  const result = transformToCosmos(parsed, options)
  return result.leads
    .filter((l) => !l.blocked)
    .map((l) => l.record)
}

export function transformToSqlRows(
  parsed: ParsedFile,
  options?: SqlTransformOptions,
): SqlRecord[] {
  const result = transformToSqlRecords(parsed, options)
  return result.records.filter((r) => !r.blocked).map((r) => r.record)
}

export function buildSqlPreviewStatement(
  rows: SqlRecord[],
  limit = 3,
): string {
  return buildSqlPreviewStatementImpl(rows, limit)
}

export { transformToCosmos, transformToSqlRecords }
export { buildCosmosBatchArray } from './transform/cosmos-generator'
export type { CosmosLeadDocument, SqlRecord, CosmosTransformOptions, SqlTransformOptions }
