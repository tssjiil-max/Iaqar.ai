const clone = (value) => JSON.parse(JSON.stringify(value));

function indexSignature(index, fieldPath) {
  // Firestore enforces uniqueness of index modes per query scope. A field
  // inherited from __default__ may use '*' instead of its concrete path.
  const fields = index.fields || [];
  if (fields.length !== 1) throw new Error('single_field_index_expected');
  const field = fields[0];
  const mode = field.order ? `order:${field.order}`
    : field.arrayConfig ? `array:${field.arrayConfig}`
    : field.vectorConfig ? `vector:${JSON.stringify(field.vectorConfig)}`
    : null;
  if (!mode) throw new Error('single_field_index_mode_missing');
  if (field.fieldPath && field.fieldPath !== '*' && field.fieldPath !== fieldPath)
    throw new Error('single_field_index_field_mismatch');
  return JSON.stringify({ queryScope: index.queryScope || 'COLLECTION', mode });
}

function supportsAnyApi(index) {
  return !index.apiScope || index.apiScope === 'ANY_API';
}

export function toFirestoreFieldIndexes(fieldOverride) {
  if (!fieldOverride || !Array.isArray(fieldOverride.indexes)) throw new Error('field_override_invalid');
  return fieldOverride.indexes.map((index) => ({
    queryScope: index.queryScope,
    fields: [{
      fieldPath: fieldOverride.fieldPath,
      ...(index.order ? { order: index.order } : {}),
      ...(index.arrayConfig ? { arrayConfig: index.arrayConfig } : {})
    }]
  }));
}

export function mergeSingleFieldIndexes(existing = [], required = [], fieldPath) {
  if (!Array.isArray(existing) || !Array.isArray(required) || !fieldPath) throw new Error('index_config_invalid');
  const merged = [];
  const positions = new Map();
  const addOrPreferAnyApi = (index) => {
    const signature = indexSignature(index, fieldPath);
    const currentPosition = positions.get(signature);
    if (currentPosition === undefined) {
      positions.set(signature, merged.length);
      merged.push(clone(index));
      return;
    }
    if (supportsAnyApi(index) && !supportsAnyApi(merged[currentPosition])) merged[currentPosition] = clone(index);
    // Never silently discard a distinct definition for the same Firestore mode.
    else if (JSON.stringify(index.fields?.[0]?.vectorConfig || null) !== JSON.stringify(merged[currentPosition].fields?.[0]?.vectorConfig || null))
      throw new Error('single_field_index_mode_conflict');
  };
  for (const index of existing) addOrPreferAnyApi(index);
  for (const index of required) addOrPreferAnyApi(index);
  return merged;
}
