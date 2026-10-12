export const PII_KINDS = ["name", "dateOfBirth", "documentNumber", "iban", "card", "email", "text"] as const;

export type PiiKind = (typeof PII_KINDS)[number];

/** Maps a field name (dot paths allowed one level deep, e.g. `payload.iban`) to its PII kind. */
export type PiiFieldMap = Record<string, PiiKind>;

/**
 * Loads the raw value of a PII field for an entity. Registered by the module that owns
 * the entity (platform or app). Returns null if the entity or field does not exist.
 */
export interface PiiResolver {
  entityType: string;
  fields: PiiFieldMap;
  /** The user must also be allowed to read the entity itself: `can(user, action, { type, id })`. */
  readCheck: { action: string; resourceType: string };
  resolve: (entityId: string, field: string) => Promise<string | null>;
}
