export async function saveExistingTemplate({ templateId, formData, fields, existingFields, mutations }) {
  await mutations.updateMutation.mutateAsync({
    templateId,
    data: formData,
  });

  const existingFieldIds = new Set(existingFields.map((field) => field.id));
  const currentFieldIds = new Set(fields.flatMap((field) => (field.id ? [field.id] : [])));
  const removedFields = existingFields.filter((field) => !currentFieldIds.has(field.id));

  await Promise.all(removedFields.map((field) => mutations.deleteFieldMutation.mutateAsync({
    templateId,
    fieldId: field.id,
  })));

  const fieldMutations = fields.flatMap((field) => {
    if (field.id && existingFieldIds.has(field.id)) {
      return [mutations.updateFieldMutation.mutateAsync({
        templateId,
        fieldId: field.id,
        fieldData: field,
      })];
    }
    if (!field.id) {
      const { temp_id: _tempId, ...fieldData } = field;
      return [mutations.addFieldMutation.mutateAsync({
        templateId,
        fieldData,
      })];
    }
    return [];
  });
  await Promise.all(fieldMutations);

  const fieldsToReorder = fields.flatMap((field, index) => (
    field.id ? [{ id: field.id, display_order: index }] : []
  ));

  if (fieldsToReorder.length > 0) {
    await mutations.reorderFieldsMutation.mutateAsync({
      templateId,
      fields: fieldsToReorder,
    });
  }
}
