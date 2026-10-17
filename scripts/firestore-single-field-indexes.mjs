const clone = (value) => JSON.parse(JSON.stringify(value));

function indexSignature(index, fieldPath) {
  return JSON.stringify({
    queryScope: index.queryScope || '',
    apiScope: index.apiScope || 'ANY_API',
    fields: (index.fields || []).map((field) => ({
      fieldPath: field.fieldPath || fieldPath,
      order: field.order || '',
      arrayConfig: field.arrayConfig || '',
      vectorConfig: field.vectorConfig || null
    }))
  });
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
  const merged = clone(existing);
  const signatures = new Set(merged.map((index) => indexSignature(index, fieldPath)));
  for (const index of required) {
    const signature = indexSignature(index, fieldPath);
    if (!signatures.has(signature)) {
      merged.push(clone(index));
      signatures.add(signature);
    }
  }
  return merged;
}
