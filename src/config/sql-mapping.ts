import type { FieldMapping } from '@/types'

/**
 * Authoritative target:
 *   dev_analytic_cxlite.analytic_leads_sales (51 cols) and
 *   dev_analytic_cxlite.eventlog
 *
 * DDL source of truth: analytics-sqlserver-lemons.md.
 * The POC writes ONE snapshot row per lead into analytic_leads_sales and
 * MUST leave the eventlog table untouched (per Phase 2B spec).
 */

export const SQL_TARGET_SCHEMA = 'dev_analytic_cxlite'
export const SQL_TARGET_TABLE = `${SQL_TARGET_SCHEMA}.analytic_leads_sales`
export const SQL_EVENTLOG_TABLE = `${SQL_TARGET_SCHEMA}.eventlog`

export interface SqlColumnMeta {
  name: string
  sqlType: string
  nullable: boolean
  maxLength?: number
  isPk?: boolean
  defaultSql?: string
  description: string
}

/**
 * Columns in physical order from the authoritative CREATE TABLE.
 * Nothing is invented here — this list must match the DDL byte-for-byte on
 * column name, type, nullability, and defaults.
 */
export const SQL_ANALYTIC_LEADS_SALES_COLUMNS: SqlColumnMeta[] = [
  { name: 'id', sqlType: 'varchar', maxLength: 100, nullable: false, isPk: true, description: 'Snapshot row ID — WA_MOBILE identifier (default `wa_<digitsPhone>`; prefix configurable per migration).' },
  { name: 'eventlog_id', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'FK to eventlog.id. NULL during the POC — eventlog is left empty.' },
  { name: 'event_name', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'LEAD_CREATED on the initial snapshot.' },
  { name: 'event_time', sqlType: 'datetime2', nullable: true, description: 'event_ts (UTC+7 wall-clock in sample, same instant as leads_created_on).' },
  { name: 'leads_source', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'data.source as-is (free text; see source taxonomy).' },
  { name: 'leads_parent_channel', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'Constant "ONLINE" per authoritative mapping rule.' },
  { name: 'leads_channel', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'UPPER(data.source).' },
  { name: 'leads_parent_id', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'Cosmos lead id (wa_<phone> on Lite).' },
  { name: 'leads_id', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'New UUIDv4 per lead (varchar, NOT uniqueidentifier).' },
  { name: 'leads_group_status', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'NEW/PRELEADS→NEW; CONTACTED/IN DISCUSSION/SITE VISIT→FOLLOWUP; WON/DROPPED/CANCELLED→CLOSED; else UNKNOWN.' },
  { name: 'leads_status', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'UPPER(data.status).' },
  { name: 'leads_group_type', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'data.group_type (empty today — Qonex has no analogue).' },
  { name: 'leads_type', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'data.type (empty today).' },
  { name: 'leads_total_score', sqlType: 'int', nullable: true, description: 'data.lead_score_data.total_score; 0 by default per DDL note.' },
  { name: 'leads_raw_score', sqlType: 'nvarchar(MAX)', nullable: true, description: 'str(dict) of lead_score_data — "{}" placeholder for the POC.' },
  { name: 'leads_created_on', sqlType: 'datetime2', nullable: true, description: 'data.createdOn parsed to datetime (UTC).' },
  { name: 'leads_changed_on', sqlType: 'datetime2', nullable: true, description: 'data.changedOn parsed to datetime (UTC).' },
  { name: 'leads_created_by', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'data.createdBy.' },
  { name: 'leads_assigned_to', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'data.assignedTo (agent name, not id).' },
  { name: 'leads_assigned_by', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'NULL in the current migration — pending Ecovia confirmation of the migration-marker policy.' },
  { name: 'leads_company', sqlType: 'varchar', maxLength: 200, nullable: true, description: 'NULL in the current migration — pending Ecovia confirmation of the company mapping.' },
  { name: 'leads_note', sqlType: 'varchar', maxLength: 2000, nullable: true, description: 'data.notes — rows whose source exceeds 2000 chars are BLOCKED (no silent truncation).' },
  { name: 'leads_qualification_level', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'NULL in the current migration — no Qonex field maps and CXLite default is unspecified.' },
  { name: 'leads_customer_budget', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'varchar; dashboards TRY_CAST to bigint.' },
  { name: 'leads_customer_name', sqlType: 'varchar', maxLength: 200, nullable: true, description: 'data.name.' },
  { name: 'leads_customer_email', sqlType: 'varchar', maxLength: 200, nullable: true, description: 'data.customerEmail.' },
  { name: 'leads_customer_phone', sqlType: 'varchar', maxLength: 50, nullable: true, description: 'Digits only, 62… (not E.164 with +).' },
  { name: 'leads_customer_address', sqlType: 'varchar', maxLength: 300, nullable: true, description: 'data.preferredLocation (NOT data.address, per DDL note).' },
  { name: 'leads_customer_ktp', sqlType: 'varchar', maxLength: 20, nullable: true, description: 'data.ktp — 16 digits when Won, else empty.' },
  { name: 'leads_project', sqlType: 'varchar', maxLength: 200, nullable: true, description: 'NULL in the current migration — pending Ecovia confirmation of the project mapping.' },
  { name: 'leads_cluster', sqlType: 'varchar', maxLength: 200, nullable: true, description: 'data.cluster.' },
  { name: 'leads_urgency', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'data.urgency.' },
  { name: 'leads_property_price', sqlType: 'bigint', nullable: true, description: 'data.property_data.price; 0 default per DDL note.' },
  { name: 'leads_raw_property', sqlType: 'nvarchar(MAX)', nullable: true, description: 'str(dict) of property_data — "{}" placeholder.' },
  { name: 'leads_financing', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'data.financing.' },
  { name: 'leads_timeline', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'data.timeline.' },
  { name: 'leads_aging', sqlType: 'bigint', nullable: true, description: 'POC initial snapshot = 0 (no prior row to diff).' },
  { name: 'sales_id', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'NULL (not populated).' },
  { name: 'sales_name', sqlType: 'varchar', maxLength: 200, nullable: true, description: 'data.assignedTo (mirror).' },
  { name: 'sales_email', sqlType: 'varchar', maxLength: 200, nullable: true, description: 'NULL (not populated).' },
  { name: 'sales_phone', sqlType: 'varchar', maxLength: 50, nullable: true, description: 'NULL (not populated).' },
  { name: 'sales_manager_id', sqlType: 'varchar', maxLength: 100, nullable: true, description: 'NULL.' },
  { name: 'sales_manager_name', sqlType: 'varchar', maxLength: 200, nullable: true, description: 'NULL — mirrors leads_assigned_by (both pending Ecovia confirmation).' },
  { name: 'sales_manager_phone', sqlType: 'varchar', maxLength: 50, nullable: true, description: 'NULL.' },
  { name: 'sales_manager_email', sqlType: 'varchar', maxLength: 200, nullable: true, description: 'NULL.' },
  { name: 'created_at', sqlType: 'datetime2', nullable: true, defaultSql: 'getdate()', description: 'Written now (UTC).' },
  { name: 'created_by', sqlType: 'varchar', maxLength: 50, nullable: true, defaultSql: "'system'", description: 'Row-provenance marker. Configurable via `rowProvenanceUser`; default "system-batch". Migration Excel proposes "DataMigration01" — awaiting Ecovia confirmation.' },
  { name: 'updated_at', sqlType: 'datetime2', nullable: true, defaultSql: 'getdate()', description: 'Equal to created_at on insert.' },
  { name: 'updated_by', sqlType: 'varchar', maxLength: 50, nullable: true, defaultSql: "'system'", description: 'Equal to created_by on insert (mirrors `rowProvenanceUser`).' },
  { name: 'deleted_at', sqlType: 'datetime2', nullable: true, description: 'NULL on insert.' },
  { name: 'deleted_by', sqlType: 'varchar', maxLength: 300, nullable: true, description: 'NULL on insert.' },
]

if (SQL_ANALYTIC_LEADS_SALES_COLUMNS.length !== 51) {
  throw new Error(
    `analytic_leads_sales expected 51 columns, got ${SQL_ANALYTIC_LEADS_SALES_COLUMNS.length}`,
  )
}

/**
 * Authoritative CREATE TABLE statements, verbatim from the DDL document.
 * The local backend uses this to apply the schema; drift triggers refusal.
 */
export const SQL_DDL = {
  schema: `IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = '${SQL_TARGET_SCHEMA}')
  EXEC('CREATE SCHEMA ${SQL_TARGET_SCHEMA}');`,

  eventlog: `IF OBJECT_ID('${SQL_EVENTLOG_TABLE}', 'U') IS NULL
BEGIN
  CREATE TABLE ${SQL_EVENTLOG_TABLE} (
    id varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    name varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [data] nvarchar(MAX) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    [time] datetime2 DEFAULT getdate() NULL,
    created_at datetime DEFAULT getdate() NULL,
    created_at_epoch bigint NULL,
    create_by varchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    CONSTRAINT PK__eventlog__3213E83F53E4C20B PRIMARY KEY (id)
  );
END;`,

  analyticLeadsSales: `IF OBJECT_ID('${SQL_TARGET_TABLE}', 'U') IS NULL
BEGIN
  CREATE TABLE ${SQL_TARGET_TABLE} (
    id varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
    eventlog_id varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    event_name varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    event_time datetime2 DEFAULT NULL NULL,
    leads_source varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_parent_channel varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_channel varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_parent_id varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_id varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_group_status varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_status varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_group_type varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_type varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_total_score int DEFAULT NULL NULL,
    leads_raw_score nvarchar(MAX) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_created_on datetime2 DEFAULT NULL NULL,
    leads_changed_on datetime2 DEFAULT NULL NULL,
    leads_created_by varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_assigned_to varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_assigned_by varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_company varchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_note varchar(2000) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_qualification_level varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_customer_budget varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_customer_name varchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_customer_email varchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_customer_phone varchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_customer_address varchar(300) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_customer_ktp varchar(20) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_project varchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_cluster varchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_urgency varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_property_price bigint DEFAULT NULL NULL,
    leads_raw_property nvarchar(MAX) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_financing varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_timeline varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    leads_aging bigint DEFAULT NULL NULL,
    sales_id varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    sales_name varchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    sales_email varchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    sales_phone varchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    sales_manager_id varchar(100) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    sales_manager_name varchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    sales_manager_phone varchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    sales_manager_email varchar(200) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT NULL NULL,
    created_at datetime2 DEFAULT getdate() NULL,
    created_by varchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT 'system' NULL,
    updated_at datetime2 DEFAULT getdate() NULL,
    updated_by varchar(50) COLLATE SQL_Latin1_General_CP1_CI_AS DEFAULT 'system' NULL,
    deleted_at datetime2 NULL,
    deleted_by varchar(300) COLLATE SQL_Latin1_General_CP1_CI_AS NULL,
    CONSTRAINT PK__analytic__3213E83FB513595A PRIMARY KEY (id)
  );
END;`,
}

/**
 * UI-facing field map for the mapping-review step. The runtime generator in
 * src/lib/transform/sql-generator.ts is authoritative; this list only drives
 * the review table.
 */
export const SQL_FIELD_MAPPINGS: FieldMapping[] = [
  { sourceField: 'nomor_telepon', destinationField: 'id', destinationPath: 'id', requirement: 'required', type: 'Transform', description: 'WA_MOBILE identifier (default `wa_<digitsPhone>`; prefix configurable). PK — duplicate phones block the row.', verified: true },
  { sourceField: null, destinationField: 'eventlog_id', destinationPath: 'eventlog_id', requirement: 'optional', type: 'Default', description: 'NULL (POC leaves eventlog empty).', verified: true },
  { sourceField: null, destinationField: 'event_name', destinationPath: 'event_name', requirement: 'optional', type: 'Default', description: 'NULL (POC does not reconstruct event taxonomy).', verified: true },
  { sourceField: 'last_update', destinationField: 'event_time', destinationPath: 'event_time', requirement: 'optional', type: 'Transform', description: 'Derived from last_update (UTC); NULL when source is empty.', verified: true },
  { sourceField: 'source_data', destinationField: 'leads_source', destinationPath: 'leads_source', requirement: 'optional', type: 'Transform', description: 'Normalized via CXLite source taxonomy; unknown values preserved as-is and flagged.', verified: true },
  { sourceField: null, destinationField: 'leads_parent_channel', destinationPath: 'leads_parent_channel', requirement: 'optional', type: 'Default', description: 'Constant "ONLINE".', verified: true },
  { sourceField: 'source_data', destinationField: 'leads_channel', destinationPath: 'leads_channel', requirement: 'optional', type: 'Transform', description: 'UPPER(source).', verified: true },
  { sourceField: 'nomor_telepon', destinationField: 'leads_parent_id', destinationPath: 'leads_parent_id', requirement: 'optional', type: 'Transform', description: 'WA_MOBILE identifier (same convention as PK `id`).', verified: true },
  { sourceField: null, destinationField: 'leads_id', destinationPath: 'leads_id', requirement: 'optional', type: 'Generated', description: 'UUIDv4 per Qonex lead (stable across re-runs — derived from Qonex ID).', verified: true },
  { sourceField: 'status', destinationField: 'leads_group_status', destinationPath: 'leads_group_status', requirement: 'optional', type: 'Transform', description: 'FSM group: NEW / FOLLOWUP / CLOSED / UNKNOWN.', verified: true },
  { sourceField: 'status', destinationField: 'leads_status', destinationPath: 'leads_status', requirement: 'optional', type: 'Transform', description: 'UPPER(status).', verified: true },
  { sourceField: null, destinationField: 'leads_group_type', destinationPath: 'leads_group_type', requirement: 'optional', type: 'Default', description: 'NULL (no Qonex analogue).', verified: false },
  { sourceField: null, destinationField: 'leads_type', destinationPath: 'leads_type', requirement: 'optional', type: 'Default', description: 'NULL (no Qonex analogue).', verified: false },
  { sourceField: null, destinationField: 'leads_total_score', destinationPath: 'leads_total_score', requirement: 'optional', type: 'Default', description: '0 (no score available).', verified: true },
  { sourceField: null, destinationField: 'leads_raw_score', destinationPath: 'leads_raw_score', requirement: 'optional', type: 'Default', description: '"{}" placeholder.', verified: true },
  { sourceField: 'create', destinationField: 'leads_created_on', destinationPath: 'leads_created_on', requirement: 'optional', type: 'Transform', description: 'UTC ISO parsed from Qonex `create`.', verified: true },
  { sourceField: 'last_update', destinationField: 'leads_changed_on', destinationPath: 'leads_changed_on', requirement: 'optional', type: 'Transform', description: 'UTC ISO parsed from `last_update` (falls back to created_on when source is empty).', verified: true },
  { sourceField: null, destinationField: 'leads_created_by', destinationPath: 'leads_created_by', requirement: 'required', type: 'Default', description: 'Constant "DataMigration01" — provenance marker (Qonex has no `createdBy` analogue).', verified: true },
  { sourceField: 'sales_rep', destinationField: 'leads_assigned_to', destinationPath: 'leads_assigned_to', requirement: 'optional', type: 'Direct', description: 'Qonex sales rep carried over as the current owner.', verified: true },
  { sourceField: null, destinationField: 'leads_assigned_by', destinationPath: 'leads_assigned_by', requirement: 'optional', type: 'Default', description: 'NULL (pending Ecovia confirmation of migration-marker policy).', verified: false },
  { sourceField: null, destinationField: 'leads_company', destinationPath: 'leads_company', requirement: 'optional', type: 'Default', description: 'NULL — company mapping pending Ecovia confirmation. (Qonex `group` is NOT silently coerced into this column.)', verified: false },
  { sourceField: 'keterangan', destinationField: 'leads_note', destinationPath: 'leads_note', requirement: 'optional', type: 'Direct', description: 'Free-form notes (varchar(2000)). Values exceeding 2000 chars BLOCK the row with the full original preserved in the issue report — no silent truncation.', verified: true },
  { sourceField: null, destinationField: 'leads_qualification_level', destinationPath: 'leads_qualification_level', requirement: 'optional', type: 'Default', description: 'NULL — no Qonex field maps to CXLite qualification level (previous "Medium" placeholder removed per Migration Excel).', verified: false },
  { sourceField: 'type_price', destinationField: 'leads_customer_budget', destinationPath: 'leads_customer_budget', requirement: 'optional', type: 'Transform', description: 'Digits-only budget parsed from Qonex `type_price` (keeps raw string when unparseable).', verified: false },
  { sourceField: 'nama_prospek', destinationField: 'leads_customer_name', destinationPath: 'leads_customer_name', requirement: 'required', type: 'Direct', description: 'Customer name.', verified: true },
  { sourceField: 'email', destinationField: 'leads_customer_email', destinationPath: 'leads_customer_email', requirement: 'optional', type: 'Transform', description: 'Lower-cased, trimmed email.', verified: true },
  { sourceField: 'nomor_telepon', destinationField: 'leads_customer_phone', destinationPath: 'leads_customer_phone', requirement: 'required', type: 'Transform', description: '62… digits only (no + / spaces / dashes).', verified: true },
  { sourceField: 'lokasi_walkin', destinationField: 'leads_customer_address', destinationPath: 'leads_customer_address', requirement: 'optional', type: 'Direct', description: 'Preferred location (walk-in location on the source).', verified: false },
  { sourceField: null, destinationField: 'leads_customer_ktp', destinationPath: 'leads_customer_ktp', requirement: 'optional', type: 'Default', description: 'Empty string in the SQL snapshot (KTP lives on Cosmos Won snapshots only).', verified: true },
  { sourceField: null, destinationField: 'leads_project', destinationPath: 'leads_project', requirement: 'optional', type: 'Default', description: 'NULL — project mapping pending Ecovia confirmation. (Qonex `group` is NOT silently coerced into this column.)', verified: false },
  { sourceField: 'cluster', destinationField: 'leads_cluster', destinationPath: 'leads_cluster', requirement: 'optional', type: 'Direct', description: 'Project cluster.', verified: true },
  { sourceField: null, destinationField: 'leads_urgency', destinationPath: 'leads_urgency', requirement: 'optional', type: 'Default', description: 'Constant "Medium".', verified: false },
  { sourceField: null, destinationField: 'leads_property_price', destinationPath: 'leads_property_price', requirement: 'optional', type: 'Default', description: '0 (property_data not available for Qonex rows).', verified: true },
  { sourceField: null, destinationField: 'leads_raw_property', destinationPath: 'leads_raw_property', requirement: 'optional', type: 'Default', description: '"{}" placeholder.', verified: true },
  { sourceField: null, destinationField: 'leads_financing', destinationPath: 'leads_financing', requirement: 'optional', type: 'Default', description: 'NULL (no Qonex analogue).', verified: false },
  { sourceField: null, destinationField: 'leads_timeline', destinationPath: 'leads_timeline', requirement: 'optional', type: 'Default', description: 'NULL (no Qonex analogue).', verified: false },
  { sourceField: null, destinationField: 'leads_aging', destinationPath: 'leads_aging', requirement: 'optional', type: 'Default', description: '0 (initial-snapshot POC — no prior row to diff).', verified: true },
  { sourceField: null, destinationField: 'sales_id', destinationPath: 'sales_id', requirement: 'optional', type: 'Default', description: 'NULL (not populated).', verified: true },
  { sourceField: 'sales_rep', destinationField: 'sales_name', destinationPath: 'sales_name', requirement: 'optional', type: 'Direct', description: 'Mirror of leads_assigned_to (= Qonex sales rep).', verified: true },
  { sourceField: null, destinationField: 'sales_email', destinationPath: 'sales_email', requirement: 'optional', type: 'Default', description: 'NULL (not populated).', verified: true },
  { sourceField: null, destinationField: 'sales_phone', destinationPath: 'sales_phone', requirement: 'optional', type: 'Default', description: 'NULL (not populated).', verified: true },
  { sourceField: null, destinationField: 'sales_manager_id', destinationPath: 'sales_manager_id', requirement: 'optional', type: 'Default', description: 'NULL (not populated).', verified: true },
  { sourceField: null, destinationField: 'sales_manager_name', destinationPath: 'sales_manager_name', requirement: 'optional', type: 'Default', description: 'NULL — mirrors leads_assigned_by (both pending Ecovia confirmation).', verified: false },
  { sourceField: null, destinationField: 'sales_manager_phone', destinationPath: 'sales_manager_phone', requirement: 'optional', type: 'Default', description: 'NULL (not populated).', verified: true },
  { sourceField: null, destinationField: 'sales_manager_email', destinationPath: 'sales_manager_email', requirement: 'optional', type: 'Default', description: 'NULL (not populated).', verified: true },
  { sourceField: null, destinationField: 'created_at', destinationPath: 'created_at', requirement: 'optional', type: 'Generated', description: 'Now (UTC) at transformation time.', verified: true },
  { sourceField: null, destinationField: 'created_by', destinationPath: 'created_by', requirement: 'optional', type: 'Default', description: 'Row-provenance marker (configurable via `rowProvenanceUser`). Default "system-batch" per the authoritative DDL; Migration Excel proposes "DataMigration01" — awaiting Ecovia confirmation. Distinct from leads_created_by.', verified: false },
  { sourceField: null, destinationField: 'updated_at', destinationPath: 'updated_at', requirement: 'optional', type: 'Generated', description: 'Equal to created_at on insert.', verified: true },
  { sourceField: null, destinationField: 'updated_by', destinationPath: 'updated_by', requirement: 'optional', type: 'Default', description: 'Equal to created_by (mirrors `rowProvenanceUser`).', verified: false },
  { sourceField: null, destinationField: 'deleted_at', destinationPath: 'deleted_at', requirement: 'optional', type: 'Default', description: 'NULL on insert (soft delete handled by downstream batch sync).', verified: true },
  { sourceField: null, destinationField: 'deleted_by', destinationPath: 'deleted_by', requirement: 'optional', type: 'Default', description: 'NULL on insert (soft delete handled by downstream batch sync).', verified: true },
]
