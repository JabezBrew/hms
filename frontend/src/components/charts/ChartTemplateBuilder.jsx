/* oxlint-disable react-doctor/prefer-useReducer -- The builder keeps independent draft/editing UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import { useMemo, useState } from 'react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { toast } from 'sonner';

import { ScrollArea } from '@/components/ui/scroll-area';
import {
  useAddChartField,
  useChartCategories,
  useChartIntervals,
  useChartTemplate,
  useCreateChartTemplate,
  useDeleteChartField,
  useReorderChartFields,
  useUpdateChartField,
  useUpdateChartTemplate,
} from '@/features/charts/hooks';
import { PageShell } from '@/shared/components/page/PageShell';

import { ChartFieldEditor } from './ChartFieldEditor';
import { ChartTemplateBasicStep } from './chart-template-builder/ChartTemplateBasicStep';
import { ChartTemplateBuilderFooter } from './chart-template-builder/ChartTemplateBuilderFooter';
import { ChartTemplateBuilderHeader } from './chart-template-builder/ChartTemplateBuilderHeader';
import { ChartTemplateFieldsStep } from './chart-template-builder/ChartTemplateFieldsStep';
import { ChartTemplatePreviewStep } from './chart-template-builder/ChartTemplatePreviewStep';
import { ChartTemplateSettingsStep } from './chart-template-builder/ChartTemplateSettingsStep';
import { ChartTemplateStepIndicator } from './chart-template-builder/ChartTemplateStepIndicator';
import {
  buildPreviewData,
  getInitialFields,
  getInitialFormData,
} from './chart-template-builder/chartTemplateBuilderOptions';
import { saveExistingTemplate } from './chart-template-builder/chartTemplateBuilderSave';

const ChartTemplateBuilder = ({ templateId, onClose, onSaved }) => {
  const { data: existingTemplate, isLoading: templateLoading } = useChartTemplate(templateId);
  const { data: categories = [] } = useChartCategories();
  const { data: intervals = [] } = useChartIntervals();
  const createMutation = useCreateChartTemplate();
  const updateMutation = useUpdateChartTemplate();
  const addFieldMutation = useAddChartField();
  const updateFieldMutation = useUpdateChartField();
  const deleteFieldMutation = useDeleteChartField();
  const reorderFieldsMutation = useReorderChartFields();

  const mutationApi = {
    addFieldMutation,
    createMutation,
    deleteFieldMutation,
    reorderFieldsMutation,
    updateFieldMutation,
    updateMutation,
  };

  const templateKey = templateId
    ? existingTemplate?.id || existingTemplate?.template_id || templateId
    : 'new-template';

  return (
    <ChartTemplateBuilderEditor
      key={templateKey}
      templateId={templateId}
      existingTemplate={existingTemplate}
      templateLoading={templateLoading}
      categories={categories}
      intervals={intervals}
      mutations={mutationApi}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
};

function ChartTemplateBuilderEditor({
  templateId,
  existingTemplate,
  templateLoading,
  categories,
  intervals,
  mutations,
  onClose,
  onSaved,
}) {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState(() => getInitialFormData(existingTemplate));
  const [fields, setFields] = useState(() => getInitialFields(existingTemplate));
  const [fieldEditorOpen, setFieldEditorOpen] = useState(false);
  const [editingField, setEditingField] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const previewData = useMemo(() => buildPreviewData(fields), [fields]);
  const isSaving = mutations.createMutation.isPending || mutations.updateMutation.isPending;
  const existingFields = existingTemplate?.fields || [];

  const updateFormField = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setFields((items) => {
      const oldIndex = items.findIndex((item) => (item.id || item.temp_id) === active.id);
      const newIndex = items.findIndex((item) => (item.id || item.temp_id) === over.id);
      if (oldIndex < 0 || newIndex < 0) return items;
      const newItems = arrayMove(items, oldIndex, newIndex);
      return newItems.map((item, idx) => ({ ...item, display_order: idx }));
    });
    setHasChanges(true);
  };

  const handleAddField = () => {
    setEditingField(null);
    setFieldEditorOpen(true);
  };

  const handleEditField = (field) => {
    setEditingField(field);
    setFieldEditorOpen(true);
  };

  const handleSaveField = (fieldData) => {
    if (editingField) {
      setFields((prev) => prev.map((field) => (
        (field.id || field.temp_id) === (editingField.id || editingField.temp_id)
          ? { ...fieldData, id: editingField.id, temp_id: editingField.temp_id }
          : field
      )));
    } else {
      setFields((prev) => [
        ...prev,
        {
          ...fieldData,
          temp_id: `temp_${Date.now()}`,
          display_order: prev.length,
        },
      ]);
    }
    setHasChanges(true);
    setFieldEditorOpen(false);
  };

  const handleDeleteField = (field) => {
    setFields((prev) => prev.filter((item) => (
      (item.id || item.temp_id) !== (field.id || field.temp_id)
    )));
    setHasChanges(true);
  };

  const validateStep = (step) => {
    if (step === 1 && !formData.name.trim()) {
      toast.error('Chart name is required');
      return false;
    }
    if (step === 2 && fields.length === 0) {
      toast.error('Add at least one field');
      return false;
    }
    return true;
  };

  const goToStep = (step) => {
    if (step > currentStep && !validateStep(currentStep)) return;
    setCurrentStep(step);
  };

  const handleSave = async () => {
    if (!validateStep(1) || !validateStep(2)) return;

    try {
      if (templateId && existingTemplate) {
        await saveExistingTemplate({
          templateId,
          formData,
          fields,
          existingFields,
          mutations,
        });
        toast.success('Chart template updated');
      } else {
        await mutations.createMutation.mutateAsync({
          ...formData,
          fields: fields.map(({ temp_id: _tempId, ...field }) => field),
        });
        toast.success('Chart template created');
      }

      setHasChanges(false);
      onSaved?.();
    } catch (err) {
      console.error('Failed to save template:', err);
    }
  };

  return (
    <PageShell className="fixed inset-0 z-[100] flex flex-col">
      <ChartTemplateBuilderHeader
        templateId={templateId}
        name={formData.name}
        onClose={onClose}
      />
      <ChartTemplateStepIndicator currentStep={currentStep} onGoToStep={goToStep} />

      <ScrollArea className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {templateLoading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner className="size-6 text-muted-foreground" />
            </div>
          ) : (
            <ChartTemplateBuilderStep
              currentStep={currentStep}
              formData={formData}
              fields={fields}
              categories={categories}
              intervals={intervals}
              sensors={sensors}
              previewData={previewData}
              onUpdateField={updateFormField}
              onAddField={handleAddField}
              onDragEnd={handleDragEnd}
              onEditField={handleEditField}
              onDeleteField={handleDeleteField}
            />
          )}
        </div>
      </ScrollArea>

      <ChartTemplateBuilderFooter
        currentStep={currentStep}
        hasChanges={hasChanges}
        isSaving={isSaving}
        templateId={templateId}
        onPrevious={() => goToStep(currentStep - 1)}
        onNext={() => goToStep(currentStep + 1)}
        onSave={handleSave}
      />

      <ChartFieldEditor
        open={fieldEditorOpen}
        onOpenChange={setFieldEditorOpen}
        field={editingField}
        onSave={handleSaveField}
        existingFieldKeys={fields.reduce((fieldKeys, field) => {
          if (field.field_key !== editingField?.field_key) {
            fieldKeys.push(field.field_key);
          }
          return fieldKeys;
        }, [])}
      />
    </PageShell>
  );
}

function ChartTemplateBuilderStep(props) {
  if (props.currentStep === 1) {
    return <ChartTemplateBasicStep {...props} />;
  }
  if (props.currentStep === 2) {
    return <ChartTemplateFieldsStep {...props} />;
  }
  if (props.currentStep === 3) {
    return <ChartTemplateSettingsStep {...props} />;
  }
  return <ChartTemplatePreviewStep {...props} />;
}

export { ChartTemplateBuilder };
