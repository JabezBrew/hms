/**
 * ChartTemplateBuilder - Chronicle-styled multi-step wizard for creating chart templates
 *
 * Steps:
 * 1. Basic Info (name, category, icon, visibility, interval)
 * 2. Fields (add/edit/reorder fields)
 * 3. Display Settings (mode, columns)
 * 4. Preview (show how data entry will look)
 */

import X from 'lucide-react/dist/esm/icons/x.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import GripVertical from 'lucide-react/dist/esm/icons/grip-vertical.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import ListOrdered from 'lucide-react/dist/esm/icons/list-ordered.js';
import Info from 'lucide-react/dist/esm/icons/info.js';
import Brain from 'lucide-react/dist/esm/icons/brain.js';
import Heart from 'lucide-react/dist/esm/icons/heart.js';
import Wind from 'lucide-react/dist/esm/icons/wind.js';
import Beaker from 'lucide-react/dist/esm/icons/beaker.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Bandage from 'lucide-react/dist/esm/icons/bandage.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.js';
import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { toast } from "sonner";
import { ChartFieldEditor } from "./ChartFieldEditor";
import { ChartFieldRenderer } from "./ChartFieldRenderer";
import {
  useChartTemplate,
  useChartCategories,
  useChartIntervals,
  useCreateChartTemplate,
  useUpdateChartTemplate,
  useAddChartField,
  useUpdateChartField,
  useDeleteChartField,
  useReorderChartFields,
} from "@/features/charts/hooks";
import { PageHeader } from "@/shared/components/page/PageHeader";
import { PageShell } from "@/shared/components/page/PageShell";

// Category icons
const CATEGORY_ICONS = {
  neurological: Brain,
  cardiovascular: Heart,
  respiratory: Wind,
  metabolic: Beaker,
  pain: Activity,
  wound: Bandage,
  custom: MoreHorizontal,
};

const SCOPE_OPTIONS = [
  { value: 'encounter', label: 'Encounter', description: 'Scoped to a single clinical visit' },
  { value: 'admission', label: 'Admission', description: 'Scoped to an inpatient admission' },
  { value: 'patient', label: 'Patient', description: 'Longitudinal across all visits' },
];

// Visibility options
const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private", description: "Only you can see" },
  { value: "role", label: "Role", description: "Same role can see" },
  { value: "department", label: "Department", description: "Department can see" },
  { value: "facility", label: "Facility", description: "Everyone can see" },
];

// Display mode options
const DISPLAY_MODES = [
  { value: "table", label: "Table", description: "Traditional grid layout" },
  { value: "grid", label: "Grid", description: "Card-based layout" },
  { value: "timeline", label: "Timeline", description: "Chronological view" },
];

// Step configuration
const STEPS = [
  { id: 1, name: "Basic Info", icon: Info },
  { id: 2, name: "Fields", icon: ListOrdered },
  { id: 3, name: "Settings", icon: Settings },
  { id: 4, name: "Preview", icon: Eye },
];

/**
 * Sortable field item for drag-drop reordering
 */
const SortableFieldItem = ({ field, index, onEdit, onDelete }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id || field.temp_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border border-border bg-card",
        "transition-all hover:border-primary/30",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium truncate">
            {field.name}
          </span>
          {field.is_required && (
            <span className="text-[9px] font-mono uppercase text-rose-500">
              Required
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-mono text-[10px] text-muted-foreground">
            {field.field_type}
          </span>
          {field.group_name && (
            <>
              <span className="text-muted-foreground">•</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {field.group_name}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(field)}
          className="h-7 w-7 p-0"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(field)}
          className="h-7 w-7 p-0 text-rose-500 hover:text-rose-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};

/**
 * ChartTemplateBuilder - Main wizard component
 */
const ChartTemplateBuilder = ({
  templateId,
  onClose,
  onSaved,
}) => {
  // Fetch existing template if editing
  const { data: existingTemplate, isLoading: templateLoading } = useChartTemplate(templateId);
  const { data: categories = [] } = useChartCategories();
  const { data: intervals = [] } = useChartIntervals();

  // Mutations
  const createMutation = useCreateChartTemplate();
  const updateMutation = useUpdateChartTemplate();
  const addFieldMutation = useAddChartField();
  const updateFieldMutation = useUpdateChartField();
  const deleteFieldMutation = useDeleteChartField();
  const reorderFieldsMutation = useReorderChartFields();

  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    category: "custom",
    scope_type: "patient",
    visibility: "private",
    default_interval: "hourly",
    display_mode: "table",
    is_active: true,
  });

  // Fields state (local copy for editing)
  const [fields, setFields] = useState([]);
  const [fieldEditorOpen, setFieldEditorOpen] = useState(false);
  const [editingField, setEditingField] = useState(null);

  // Track unsaved changes
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize from existing template
  useEffect(() => {
    if (existingTemplate) {
      setFormData({
        name: existingTemplate.name || "",
        description: existingTemplate.description || "",
        category: existingTemplate.category || "custom",
        scope_type: existingTemplate.scope_type || "patient",
        visibility: existingTemplate.visibility || "private",
        default_interval: existingTemplate.default_interval || "hourly",
        display_mode: existingTemplate.display_mode || "table",
        is_active: existingTemplate.is_active ?? true,
      });
      setFields(existingTemplate.fields || []);
    }
  }, [existingTemplate]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag end
  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      setFields((items) => {
        const oldIndex = items.findIndex((i) => (i.id || i.temp_id) === active.id);
        const newIndex = items.findIndex((i) => (i.id || i.temp_id) === over.id);
        const newItems = arrayMove(items, oldIndex, newIndex);
        // Update display_order
        return newItems.map((item, idx) => ({ ...item, display_order: idx }));
      });
      setHasChanges(true);
    }
  };

  // Update form field
  const updateFormField = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  // Add new field
  const handleAddField = () => {
    setEditingField(null);
    setFieldEditorOpen(true);
  };

  // Edit existing field
  const handleEditField = (field) => {
    setEditingField(field);
    setFieldEditorOpen(true);
  };

  // Save field from editor
  const handleSaveField = (fieldData) => {
    if (editingField) {
      // Update existing
      setFields((prev) =>
        prev.map((f) =>
          (f.id || f.temp_id) === (editingField.id || editingField.temp_id)
            ? { ...fieldData, id: editingField.id, temp_id: editingField.temp_id }
            : f
        )
      );
    } else {
      // Add new
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

  // Delete field
  const handleDeleteField = (field) => {
    setFields((prev) => prev.filter((f) => (f.id || f.temp_id) !== (field.id || field.temp_id)));
    setHasChanges(true);
  };

  // Validate current step
  const validateStep = (step) => {
    switch (step) {
      case 1:
        if (!formData.name.trim()) {
          toast.error("Chart name is required");
          return false;
        }
        return true;
      case 2:
        if (fields.length === 0) {
          toast.error("Add at least one field");
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  // Navigate steps
  const goToStep = (step) => {
    if (step > currentStep && !validateStep(currentStep)) {
      return;
    }
    setCurrentStep(step);
  };

  const nextStep = () => goToStep(currentStep + 1);
  const prevStep = () => goToStep(currentStep - 1);

  // Save template
  const handleSave = async () => {
    if (!validateStep(1) || !validateStep(2)) {
      return;
    }

    try {
      if (templateId && existingTemplate) {
        // Update existing template
        await updateMutation.mutateAsync({
          templateId,
          data: formData,
        });

        // Handle field changes
        const existingFieldIds = new Set(existingTemplate.fields?.map((f) => f.id) || []);
        const currentFieldIds = new Set(fields.filter((f) => f.id).map((f) => f.id));

        // Delete removed fields
        for (const field of existingTemplate.fields || []) {
          if (!currentFieldIds.has(field.id)) {
            await deleteFieldMutation.mutateAsync({
              templateId,
              fieldId: field.id,
            });
          }
        }

        // Add new fields and update existing
        for (const field of fields) {
          if (field.id && existingFieldIds.has(field.id)) {
            // Update existing field
            await updateFieldMutation.mutateAsync({
              templateId,
              fieldId: field.id,
              fieldData: field,
            });
          } else if (!field.id) {
            // Add new field
            const { temp_id, ...fieldData } = field;
            await addFieldMutation.mutateAsync({
              templateId,
              fieldData,
            });
          }
        }

        // Reorder if needed
        const fieldIds = fields.filter((f) => f.id).map((f) => f.id);
        if (fieldIds.length > 0) {
          await reorderFieldsMutation.mutateAsync({
            templateId,
            fields: fields.filter((field) => field.id).map((field, index) => ({
              id: field.id,
              display_order: index,
            })),
          });
        }

        toast.success("Chart template updated");
      } else {
        // Create new template with fields
        const result = await createMutation.mutateAsync({
          ...formData,
          fields: fields.map(({ temp_id, ...field }) => field),
        });

        toast.success("Chart template created");
      }

      setHasChanges(false);
      onSaved?.();
    } catch (err) {
      console.error("Failed to save template:", err);
    }
  };

  const isLoading = templateLoading;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Preview data for step 4
  const previewData = useMemo(() => {
    const data = {};
    fields.forEach((field) => {
      if (field.field_type === "numeric") {
        data[field.field_key] = field.config?.default ?? 0;
      } else if (field.field_type === "boolean") {
        data[field.field_key] = false;
      } else if (field.field_type === "select") {
        data[field.field_key] = field.config?.options?.[0]?.value ?? "";
      } else if (field.field_type === "scale") {
        const min = field.config?.min ?? 0;
        const max = field.config?.max ?? 10;
        data[field.field_key] = Math.floor((min + max) / 2);
      } else {
        data[field.field_key] = null;
      }
    });
    return data;
  }, [fields]);

  return (
    <PageShell className="fixed inset-0 z-[100] flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="px-6 py-4">
          <PageHeader
            wrap={false}
            title={(
              <span className="flex items-center gap-3">
                <span className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <ClipboardList className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </span>
                {templateId ? "Edit Chart Template" : "New Chart Template"}
              </span>
            )}
            description={formData.name || null}
            descriptionClassName="font-mono text-xs text-muted-foreground mt-0.5"
            titleClassName="text-xl"
            actions={(
              <Button
                variant="destructive"
                size="sm"
                onClick={onClose}
                className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
              >
                <X className="h-4 w-4 mr-1.5" />
                Close
              </Button>
            )}
          />
        </div>
      </header>

      {/* Step indicator */}
      <div className="px-6 py-4 bg-muted/30 border-b border-border">
        <div className="flex items-center justify-center gap-2">
          {STEPS.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;

            return (
              <div key={step.id} className="flex items-center">
                {index > 0 && (
                  <div
                    className={cn(
                      "h-px w-12 mx-2",
                      isCompleted ? "bg-amber-500" : "bg-border"
                    )}
                  />
                )}
                <button
                  onClick={() => goToStep(step.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all",
                    isActive && "bg-amber-100 dark:bg-amber-900/30",
                    !isActive && "hover:bg-muted"
                  )}
                >
                  <span
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono",
                      isCompleted
                        ? "bg-amber-500 text-white"
                        : isActive
                        ? "bg-amber-500 text-white"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {isCompleted ? <Check className="h-3.5 w-3.5" /> : step.id}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-xs hidden sm:inline",
                      isActive ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {step.name}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Step 1: Basic Info */}
              {currentStep === 1 && (
                <div className="space-y-6 animate-chronicle-enter">
                  <div>
                    <h2 className="font-display text-lg text-foreground mb-1">
                      Basic Information
                    </h2>
                    <p className="font-mono text-xs text-muted-foreground">
                      Define the chart template basics
                    </p>
                  </div>

                  <div className="space-y-4">
                    {/* Name */}
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Chart Name *
                      </Label>
                      <Input
                        value={formData.name}
                        onChange={(e) => updateFormField("name", e.target.value)}
                        placeholder="e.g., Glasgow Coma Scale"
                        className="font-mono"
                      />
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Description
                      </Label>
                      <Textarea
                        value={formData.description}
                        onChange={(e) => updateFormField("description", e.target.value)}
                        placeholder="Brief description of what this chart monitors..."
                        className="font-mono text-sm resize-none"
                        rows={3}
                      />
                    </div>

                    {/* Category */}
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Category
                      </Label>
                      <Select
                        value={formData.category}
                        onValueChange={(value) => updateFormField("category", value)}
                      >
                        <SelectTrigger className="font-mono">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[200]">
                          {categories.map((cat) => {
                            const Icon = CATEGORY_ICONS[cat.value] || MoreHorizontal;
                            return (
                              <SelectItem key={cat.value} value={cat.value} className="font-mono">
                                <div className="flex items-center gap-2">
                                  <Icon className="h-4 w-4" />
                                  {cat.label}
                                </div>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Visibility */}
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Visibility
                      </Label>
                      <div className="grid grid-cols-2 gap-2">
                        {VISIBILITY_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => updateFormField("visibility", opt.value)}
                            className={cn(
                              "p-3 rounded-lg border text-left transition-all",
                              formData.visibility === opt.value
                                ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                                : "border-border hover:border-primary/30"
                            )}
                          >
                            <p className="font-mono text-sm font-medium">{opt.label}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">
                              {opt.description}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Scope
                      </Label>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {SCOPE_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => updateFormField("scope_type", opt.value)}
                            className={cn(
                              "p-3 rounded-lg border text-left transition-all",
                              formData.scope_type === opt.value
                                ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                                : "border-border hover:border-primary/30"
                            )}
                          >
                            <p className="font-mono text-sm font-medium">{opt.label}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">
                              {opt.description}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Default Interval */}
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Default Monitoring Interval
                      </Label>
                      <Select
                        value={formData.default_interval}
                        onValueChange={(value) => updateFormField("default_interval", value)}
                      >
                        <SelectTrigger className="font-mono">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[200]">
                          {intervals.map((interval) => (
                            <SelectItem key={interval.value} value={interval.value} className="font-mono">
                              {interval.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Fields */}
              {currentStep === 2 && (
                <div className="space-y-6 animate-chronicle-enter">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-display text-lg text-foreground mb-1">
                        Chart Fields
                      </h2>
                      <p className="font-mono text-xs text-muted-foreground">
                        Add and configure fields for data entry
                      </p>
                    </div>
                    <Button
                      onClick={handleAddField}
                      size="sm"
                      className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      Add Field
                    </Button>
                  </div>

                  {fields.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-border rounded-xl">
                      <ListOrdered className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                      <p className="font-mono text-sm text-muted-foreground">
                        No fields yet
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground mt-1">
                        Click "Add Field" to start building your chart
                      </p>
                    </div>
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={fields.map((f) => f.id || f.temp_id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-2">
                          {fields.map((field, index) => (
                            <SortableFieldItem
                              key={field.id || field.temp_id}
                              field={field}
                              index={index}
                              onEdit={handleEditField}
                              onDelete={handleDeleteField}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  )}
                </div>
              )}

              {/* Step 3: Display Settings */}
              {currentStep === 3 && (
                <div className="space-y-6 animate-chronicle-enter">
                  <div>
                    <h2 className="font-display text-lg text-foreground mb-1">
                      Display Settings
                    </h2>
                    <p className="font-mono text-xs text-muted-foreground">
                      Configure how chart data is displayed
                    </p>
                  </div>

                  <div className="space-y-4">
                    {/* Display Mode */}
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Display Mode
                      </Label>
                      <div className="grid grid-cols-3 gap-3">
                        {DISPLAY_MODES.map((mode) => (
                          <button
                            key={mode.value}
                            onClick={() => updateFormField("display_mode", mode.value)}
                            className={cn(
                              "p-4 rounded-lg border text-center transition-all",
                              formData.display_mode === mode.value
                                ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                                : "border-border hover:border-primary/30"
                            )}
                          >
                            <p className="font-mono text-sm font-medium">{mode.label}</p>
                            <p className="font-mono text-[10px] text-muted-foreground mt-1">
                              {mode.description}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Active Status */}
                    <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                      <div>
                        <p className="font-mono text-sm font-medium">Active</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          Template can be assigned to patients
                        </p>
                      </div>
                      <Switch
                        checked={formData.is_active}
                        onCheckedChange={(checked) => updateFormField("is_active", checked)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Preview */}
              {currentStep === 4 && (
                <div className="space-y-6 animate-chronicle-enter">
                  <div>
                    <h2 className="font-display text-lg text-foreground mb-1">
                      Preview
                    </h2>
                    <p className="font-mono text-xs text-muted-foreground">
                      See how the chart entry form will look
                    </p>
                  </div>

                  <div className="border border-border rounded-xl overflow-hidden">
                    {/* Preview Header */}
                    <div className="px-4 py-3 bg-muted/30 border-b border-border">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                          <ClipboardList className="h-4 w-4 text-amber-600" />
                        </div>
                        <div>
                          <h3 className="font-display text-base">
                            {formData.name || "Chart Template"}
                          </h3>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {fields.length} field{fields.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Preview Fields */}
                    <div className="p-4 space-y-4">
                      {fields.length === 0 ? (
                        <p className="text-center py-8 text-muted-foreground font-mono text-sm">
                          Add fields to see preview
                        </p>
                      ) : (
                        fields.map((field) => (
                          <ChartFieldRenderer
                            key={field.id || field.temp_id}
                            field={field}
                            value={previewData[field.field_key]}
                            onChange={() => {}}
                            disabled
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-border bg-card">
        <div className="flex items-center justify-between max-w-3xl mx-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={prevStep}
            disabled={currentStep === 1}
            className="font-mono text-xs"
          >
            <ChevronLeft className="h-3.5 w-3.5 mr-1" />
            Previous
          </Button>

          <div className="flex items-center gap-2">
            {hasChanges && (
              <span className="font-mono text-[10px] text-muted-foreground">
                Unsaved changes
              </span>
            )}
            {currentStep < 4 ? (
              <Button
                size="sm"
                onClick={nextStep}
                className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                    {templateId ? "Update Template" : "Create Template"}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </footer>

      {/* Field Editor Modal */}
      <ChartFieldEditor
        open={fieldEditorOpen}
        onOpenChange={setFieldEditorOpen}
        field={editingField}
        onSave={handleSaveField}
        existingFieldKeys={fields.map((f) => f.field_key).filter((k) => k !== editingField?.field_key)}
      />
    </PageShell>
  );
};

export { ChartTemplateBuilder };
export default ChartTemplateBuilder;
