import type { FieldMapping } from '@/types'

/**
 * LEMONS / Cosmos DB target.
 *
 * Two containers:
 *   - `leads`      : regular live leads
 *   - `leads-won`  : won/dropped snapshots (originalLeadId FK)
 *
 * Partition key is `/id` for BOTH containers (spec constraint).
 *
 * Two configurable product profiles affect ID generation + duplicate policy:
 *   - 'lite' → id = `wa_<normalizedPhone>` (one lead per phone)
 *   - 'pro'  → id = UUIDv4 (duplicate policy keyed on phone + assignedTo)
 *
 * Mapping below describes the UI-level pairs; the generator in
 * `src/lib/transform/cosmos-generator.ts` is authoritative about shape.
 */

export type CosmosProductProfile = 'lite' | 'pro'

export const COSMOS_LEADS_CONTAINER = 'leads'
export const COSMOS_LEADS_WON_CONTAINER = 'leads-won'
export const COSMOS_PARTITION_KEY = '/id'

export const DEFAULT_COSMOS_PROFILE: CosmosProductProfile = 'lite'

export interface CosmosConfig {
  profile: CosmosProductProfile
  waMobilePrefix: string
}

export const DEFAULT_COSMOS_CONFIG: CosmosConfig = {
  profile: DEFAULT_COSMOS_PROFILE,
  waMobilePrefix: 'wa_',
}

export const LEMON_FIELD_MAPPINGS: FieldMapping[] = [
  { sourceField: null, destinationField: 'id', destinationPath: 'id', requirement: 'required', type: 'Generated', description: 'Partition key — profile-dependent (wa_<phone> for Lite, UUID for Pro).', verified: true },
  { sourceField: 'ID', destinationField: 'legacyCrmId', destinationPath: 'legacyCrmId', requirement: 'required', type: 'Direct', description: 'Original Qonex ID preserved for cross-reference.', verified: true },
  { sourceField: 'nama_prospek', destinationField: 'name', destinationPath: 'name', requirement: 'required', type: 'Direct', description: 'Prospect name.', verified: true },
  { sourceField: 'nomor_telepon', destinationField: 'customerPhone', destinationPath: 'customerPhone', requirement: 'required', type: 'Transform', description: 'Normalized Indonesian phone (E.164).', verified: true },
  { sourceField: 'email', destinationField: 'customerEmail', destinationPath: 'customerEmail', requirement: 'optional', type: 'Transform', description: 'Lowercased trimmed email.', verified: false },
  { sourceField: 'source_data', destinationField: 'source', destinationPath: 'source', requirement: 'required', type: 'Transform', description: 'Normalized source taxonomy.', verified: false },
  { sourceField: 'category_source', destinationField: 'sourceCategory', destinationPath: 'sourceCategory', requirement: 'optional', type: 'Direct', description: 'Detailed source category.', verified: false },
  { sourceField: 'group', destinationField: 'company', destinationPath: 'company', requirement: 'optional', type: 'Direct', description: 'Resolved company name (defaults to group).', verified: false },
  { sourceField: 'status', destinationField: 'status', destinationPath: 'status', requirement: 'required', type: 'Transform', description: 'Cosmos status taxonomy (hot/warm/cold/won/dropped/…).', verified: false },
  { sourceField: 'create', destinationField: 'createdOn', destinationPath: 'createdOn', requirement: 'required', type: 'Transform', description: 'ISO 8601 UTC.', verified: false },
  { sourceField: 'last_update', destinationField: 'changedOn', destinationPath: 'changedOn', requirement: 'optional', type: 'Transform', description: 'ISO 8601 UTC.', verified: false },
  { sourceField: 'sales_rep', destinationField: 'createdBy', destinationPath: 'createdBy', requirement: 'required', type: 'Direct', description: 'User (or sales rep) who originated the lead.', verified: false },
  { sourceField: 'sales_rep', destinationField: 'assignedTo', destinationPath: 'assignedTo', requirement: 'optional', type: 'Direct', description: 'Current owner.', verified: false },
  { sourceField: 'interest_type', destinationField: 'interestType', destinationPath: 'interestType', requirement: 'optional', type: 'Direct', description: 'Interest classification.', verified: false },
  { sourceField: 'type_price', destinationField: 'priceTier', destinationPath: 'priceTier', requirement: 'optional', type: 'Direct', description: 'Price tier bucket.', verified: false },
  { sourceField: 'cluster', destinationField: 'cluster', destinationPath: 'project.cluster', requirement: 'optional', type: 'Nested', description: 'Project cluster — nested under `project`.', verified: false },
  { sourceField: 'keterangan', destinationField: 'notes', destinationPath: 'notes', requirement: 'optional', type: 'Direct', description: 'Free-form notes.', verified: false },
  { sourceField: 'lat', destinationField: 'latitude', destinationPath: 'geo.lat', requirement: 'optional', type: 'Transform', description: 'Latitude (6 decimals).', verified: false },
  { sourceField: 'long', destinationField: 'longitude', destinationPath: 'geo.lng', requirement: 'optional', type: 'Transform', description: 'Longitude (6 decimals).', verified: false },
  { sourceField: 'total_wa', destinationField: 'whatsappCount', destinationPath: 'engagement.whatsappCount', requirement: 'optional', type: 'Transform', description: 'Integer WA interactions.', verified: false },
  { sourceField: 'total_call', destinationField: 'callCount', destinationPath: 'engagement.callCount', requirement: 'optional', type: 'Transform', description: 'Integer call interactions.', verified: false },
  { sourceField: 'first_contact', destinationField: 'firstContactAt', destinationPath: 'engagement.firstContactAt', requirement: 'optional', type: 'Transform', description: 'First contact timestamp.', verified: false },
  { sourceField: 'visit_at', destinationField: 'lastVisitAt', destinationPath: 'engagement.lastVisitAt', requirement: 'optional', type: 'Transform', description: 'Last visit timestamp.', verified: false },
  { sourceField: null, destinationField: 'sourceSystem', destinationPath: 'sourceSystem', requirement: 'required', type: 'Default', description: 'Constant "QONEX".', verified: true },
  { sourceField: null, destinationField: 'migrationRunId', destinationPath: 'migrationRunId', requirement: 'required', type: 'Generated', description: 'Run identifier.', verified: true },
  { sourceField: null, destinationField: 'migrationBatchId', destinationPath: 'migrationBatchId', requirement: 'required', type: 'Generated', description: 'Batch identifier.', verified: true },
  { sourceField: null, destinationField: 'migrationMarker', destinationPath: 'migrationMarker', requirement: 'required', type: 'Default', description: 'Constant "MIGRATION_V1".', verified: true },
  { sourceField: null, destinationField: 'migrationDryRun', destinationPath: 'migrationDryRun', requirement: 'required', type: 'Generated', description: 'DRY_RUN flag (false for real, true for simulated).', verified: true },
  { sourceField: null, destinationField: 'migratedAt', destinationPath: 'migratedAt', requirement: 'required', type: 'Generated', description: 'ISO 8601 UTC timestamp of transformation.', verified: true },
]

/**
 * Fields that MAY appear on a Won snapshot but are not required for a regular
 * lead. The engine will BLOCK a Won record missing any of the required Won
 * fields (dealValue, KTP, project+cluster+block+unit) rather than silently
 * downgrade.
 */
export const COSMOS_WON_REQUIRED_FIELDS = [
  'dealValue',
  'ktp',
  'project',
  'cluster',
  'block',
  'unitNumber',
] as const
