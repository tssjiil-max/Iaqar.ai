const clone = (value) => JSON.parse(JSON.stringify(value));

function indexSignature(index, fieldPath) {
  return JSON.stringify({
    queryScope: index.queryScope || '',
    fields: (index.fields || []).map((field) => ({
      fieldPath: field.fieldPath || fieldPath,
      order: field.order || '',
      arrayConfig: field.arrayConfig || '',
      vectorConfig: field.vectorConfig || null
    }))
  });
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
  };
  for (const index of existing) addOrPreferAnyApi(index);
  for (const index of required) addOrPreferAnyApi(index);
  return merged;
}
