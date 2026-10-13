import type { FieldMapping } from '@/types'

/**
 * Authoritative CXLite Cosmos layout (per buat-ricad §2):
 *
 *   Database:            cxlite
 *   Container `leads`:   partition key /id
 *   Container `leads-won`: partition key /id, snapshot of Won/Dropped leads
 *
 * Two product profiles:
 *   Lite  → `id = wa_<phone>`, one lead per phone (rejected on collision)
 *   Pro   → `id = UUIDv4`, duplicates allowed when (phone, assignedTo) differs
 *
 * Phone is stored as 62… digits only (no +, no spaces, no dashes).
 */

export type CosmosProductProfile = 'lite' | 'pro'

export const COSMOS_DATABASE_NAME = 'cxlite'
export const COSMOS_LEADS_CONTAINER = 'leads'
export const COSMOS_LEADS_WON_CONTAINER = 'leads-won'
export const COSMOS_PARTITION_KEY = '/id'

export const DEFAULT_COSMOS_PROFILE: CosmosProductProfile = 'lite'

export interface CosmosConfig {
  profile: CosmosProductProfile
  waMobilePrefix: string
  defaultCompany?: string
  systemName?: string
}

export const DEFAULT_COSMOS_CONFIG: CosmosConfig = {
  profile: DEFAULT_COSMOS_PROFILE,
  waMobilePrefix: 'wa_',
  defaultCompany: undefined,
  systemName: 'Migration',
}

/**
 * Required Won fields enforced at the migration layer (buat-ricad §3.3):
 *   dealValue (>0, ≤ 1,000,000,000,000, digits only)
 *   project (2-100 chars)
 *   cluster (2-100 chars)
 *   blok (1-50 chars)      ← note spelling: "blok", not "block"
 *   unitNumber (1-50 chars)
 *   ktp (exactly 16 digits)
 */
export const COSMOS_WON_REQUIRED_FIELDS = [
  'dealValue',
  'ktp',
  'project',
  'cluster',
  'blok',
  'unitNumber',
] as const

export const COSMOS_WON_ID_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const COSMOS_WON_ID_LENGTH = 6

/**
 * UI-facing mapping summary for the mapping-review step. The real engine
 * (src/lib/transform/cosmos-generator.ts) is authoritative; this list drives
 * the review table only.
 */
export const LEMON_FIELD_MAPPINGS: FieldMapping[] = [
  { sourceField: null, destinationField: 'id', destinationPath: 'id', requirement: 'required', type: 'Generated', description: 'Lite: wa_<phone>; Pro: UUIDv4. Partition key /id.', verified: true },
  { sourceField: 'nama_prospek', destinationField: 'name', destinationPath: 'name', requirement: 'required', type: 'Direct', description: 'Customer full name.', verified: true },
  { sourceField: 'nomor_telepon', destinationField: 'customerPhone', destinationPath: 'customerPhone', requirement: 'required', type: 'Transform', description: '62… digits only (no +).', verified: true },
  { sourceField: 'email', destinationField: 'customerEmail', destinationPath: 'customerEmail', requirement: 'optional', type: 'Transform', description: 'Lowercased, trimmed; null when empty.', verified: true },
  { sourceField: 'source_data', destinationField: 'source', destinationPath: 'source', requirement: 'required', type: 'Transform', description: 'CXLite source taxonomy (Ads/Organic/Referral/…); unknown values pass through as "Other".', verified: true },
  { sourceField: 'group', destinationField: 'company', destinationPath: 'company', requirement: 'required', type: 'Direct', description: 'Company display name — must resolve in `companies` container.', verified: false },
  { sourceField: 'status', destinationField: 'status', destinationPath: 'status', requirement: 'optional', type: 'Transform', description: 'CXLite status (New/Contacted/In Discussion/Site Visit/Won/Dropped/Cancelled).', verified: true },
  { sourceField: 'create', destinationField: 'createdOn', destinationPath: 'createdOn', requirement: 'required', type: 'Transform', description: 'Original lead creation time (ISO 8601, UTC+07:00 or Z).', verified: true },
  { sourceField: 'last_update', destinationField: 'changedOn', destinationPath: 'changedOn', requirement: 'required', type: 'Transform', description: 'Last activity (ISO 8601).', verified: true },
  { sourceField: 'sales_rep', destinationField: 'createdBy', destinationPath: 'createdBy', requirement: 'required', type: 'Direct', description: 'Creator name (must resolve to CXLite user).', verified: false },
  { sourceField: 'sales_rep', destinationField: 'assignedTo', destinationPath: 'assignedTo', requirement: 'optional', type: 'Direct', description: 'Current owner (agent name).', verified: true },
  { sourceField: 'cluster', destinationField: 'cluster', destinationPath: 'cluster', requirement: 'optional', type: 'Direct', description: 'Property cluster ("" if unknown, never null).', verified: true },
  { sourceField: 'group', destinationField: 'project', destinationPath: 'project', requirement: 'optional', type: 'Direct', description: 'Property project name ("" if unknown).', verified: false },
  { sourceField: 'keterangan', destinationField: 'notes', destinationPath: 'notes', requirement: 'optional', type: 'Direct', description: 'Free-form notes.', verified: true },
  { sourceField: 'ID', destinationField: 'legacyCrmId', destinationPath: 'legacyCrmId', requirement: 'optional', type: 'Direct', description: 'Original Qonex ID preserved for cross-reference (CXLite ignores extra fields).', verified: true },
  { sourceField: null, destinationField: 'interactions', destinationPath: 'interactions', requirement: 'optional', type: 'Default', description: 'Empty array for migrated leads.', verified: true },
  { sourceField: null, destinationField: 'reassignmentTriedAgents', destinationPath: 'reassignmentTriedAgents', requirement: 'optional', type: 'Default', description: 'Empty array for migrated leads.', verified: true },
  { sourceField: null, destinationField: 'phonePermission', destinationPath: 'phonePermission', requirement: 'optional', type: 'Default', description: 'true (CXLite default).', verified: true },
  { sourceField: null, destinationField: 'qualificationLevel', destinationPath: 'qualificationLevel', requirement: 'optional', type: 'Default', description: '"Medium" unless source conveys otherwise.', verified: true },
  { sourceField: null, destinationField: 'urgency', destinationPath: 'urgency', requirement: 'optional', type: 'Default', description: 'Mirrors qualificationLevel.', verified: true },
  { sourceField: null, destinationField: 'preferredLocation', destinationPath: 'preferredLocation', requirement: 'optional', type: 'Default', description: 'Empty string, never null.', verified: true },
  { sourceField: null, destinationField: '_partitionKey', destinationPath: '_partitionKey', requirement: 'optional', type: 'Generated', description: 'Informational on leads container (= lowercased source).', verified: true },
]
