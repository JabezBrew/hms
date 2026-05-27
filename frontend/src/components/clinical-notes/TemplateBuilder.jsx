import Check from 'lucide-react/dist/esm/icons/check.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import ListOrdered from 'lucide-react/dist/esm/icons/list-ordered.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Lock from 'lucide-react/dist/esm/icons/lock.js';
import MoveDown from 'lucide-react/dist/esm/icons/move-down.js';
import MoveUp from 'lucide-react/dist/esm/icons/move-up.js';
import PlusCircle from 'lucide-react/dist/esm/icons/circle-plus.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Globe from 'lucide-react/dist/esm/icons/globe.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import LogOut from 'lucide-react/dist/esm/icons/log-out.js';
import Heart from 'lucide-react/dist/esm/icons/heart.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Folder from 'lucide-react/dist/esm/icons/folder.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import CircleDot from 'lucide-react/dist/esm/icons/circle-dot.js';
import { useMemo, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useCreateNoteTemplate, useUpdateNoteTemplate } from '@/features/clinical-notes/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private', icon: Lock, description: 'Only you can see and use this template.' },
  { value: 'role', label: 'My Role', icon: Users, description: 'Shared with clinicians who have your role.' },
  { value: 'department', label: 'Department', icon: Building2, description: 'Shared with members of a department.' },
  { value: 'public', label: 'Public', icon: Globe, description: 'Available across the facility.' },
];

const CATEGORY_OPTIONS = [
  { value: 'general', label: 'General', icon: FileText },
  { value: 'soap', label: 'SOAP Notes', icon: ClipboardList },
  { value: 'progress', label: 'Progress Notes', icon: FileText },
  { value: 'procedure', label: 'Procedure Notes', icon: Activity },
  { value: 'admission', label: 'Admission Notes', icon: UserPlus },
  { value: 'discharge', label: 'Discharge Notes', icon: LogOut },
  { value: 'nursing', label: 'Nursing Notes', icon: Heart },
  { value: 'consultation', label: 'Consultation Notes', icon: Stethoscope },
  { value: 'custom', label: 'Custom', icon: Folder },
];

const ICON_OPTIONS = [
  { value: 'file-text', label: 'File Text' },
  { value: 'clipboard-list', label: 'Clipboard List' },
  { value: 'activity', label: 'Activity' },
  { value: 'user-plus', label: 'User Plus' },
  { value: 'log-out', label: 'Log Out' },
  { value: 'heart-pulse', label: 'Heart Pulse' },
  { value: 'stethoscope', label: 'Stethoscope' },
  { value: 'pill', label: 'Pill' },
  { value: 'syringe', label: 'Syringe' },
  { value: 'thermometer', label: 'Thermometer' },
];

const SECTION_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'observation', label: 'Observation' },
  { value: 'condition', label: 'Condition' },
  { value: 'medication_administration', label: 'Medication Administration' },
];

const OBSERVATION_TYPES = [
  { value: 'vitals', label: 'Vitals' },
  { value: 'subjective_symptoms', label: 'Subjective Symptoms' },
  { value: 'allergy', label: 'Allergy' },
  { value: 'fluid_balance', label: 'Fluid Balance' },
];

const TEMPLATE_MODE_OPTIONS = [
  { value: 'structured', label: 'Structured' },
  { value: 'written', label: 'Written' },
  { value: 'hybrid', label: 'Hybrid' },
];

const QUICK_STARTS = [
  {
    value: 'soap',
    label: 'SOAP',
    category: 'soap',
    estimatedSteps: 4,
    sections: [
      { section: 'Subjective', type: 'text', required: true },
      { section: 'Objective', type: 'observation', observation_type: 'vitals', required: true },
      { section: 'Assessment', type: 'condition', required: true },
      { section: 'Plan', type: 'text', required: true },
    ],
  },
  {
    value: 'hpi',
    label: 'HPI',
    category: 'consultation',
    estimatedSteps: 6,
    sections: [
      { section: 'Presenting Complaint(s)', type: 'text', required: true },
      { section: 'History of Presenting Complaint', type: 'text', required: true },
      { section: 'Past Medical History', type: 'text', required: false },
      { section: 'Allergies', type: 'observation', observation_type: 'allergy', required: false },
      { section: 'Physical Examination', type: 'text', required: true },
      { section: 'Plan', type: 'text', required: true },
    ],
  },
  {
    value: 'nursing_vitals',
    label: 'Nursing Vitals',
    category: 'nursing',
    estimatedSteps: 2,
    sections: [
      { section: 'Vitals', type: 'observation', observation_type: 'vitals', required: true },
      { section: 'Nurse Notes', type: 'text', required: false },
    ],
  },
  {
    value: 'nursing_io',
    label: 'Nursing I/O',
    category: 'nursing',
    estimatedSteps: 2,
    sections: [
      { section: 'I/O Chart', type: 'observation', observation_type: 'fluid_balance', required: true },
      { section: 'Nurse Notes', type: 'text', required: false },
    ],
  },
  {
    value: 'nursing_meds',
    label: 'Nursing Meds',
    category: 'nursing',
    estimatedSteps: 2,
    sections: [
      { section: 'Medication Given', type: 'medication_administration', required: true },
      { section: 'Nurse Notes', type: 'text', required: false },
    ],
  },
];

const STEPS = [
  { id: 1, name: 'Basics', icon: FileText },
  { id: 2, name: 'Access', icon: Lock },
  { id: 3, name: 'Structure', icon: ListOrdered },
  { id: 4, name: 'Review', icon: Eye },
];

const toSectionDraft = (section = {}) => ({
  section: section.name || section.section || '',
  type: section.type || 'text',
  required: section.required ?? false,
  observation_type: section.observationType || section.observation_type || '',
  default_text: section.default_text || section.defaultText || '',
});

const getInitialStructure = (initialTemplate) => {
  if (!initialTemplate?.structure) {
    return [];
  }

  if (Array.isArray(initialTemplate.structure)) {
    return initialTemplate.structure.map((section) => toSectionDraft(section));
  }

  if (Array.isArray(initialTemplate.structure.sections)) {
    return initialTemplate.structure.sections.map((section) => toSectionDraft(section));
  }

  return [];
};

const TemplateBuilder = ({ onSuccess, initialTemplate = null }) => {
  const [currentStep, setCurrentStep] = useState(1);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    trigger,
    getValues,
    formState: { errors, isDirty },
  } = useForm({
    defaultValues: {
      title: initialTemplate?.title || '',
      description: initialTemplate?.description || '',
      is_active: initialTemplate?.is_active ?? true,
      visibility: initialTemplate?.visibility || 'private',
      department: initialTemplate?.department || '',
      category: initialTemplate?.category || 'custom',
      icon: initialTemplate?.icon || 'file-text',
      estimated_steps: initialTemplate?.estimated_steps || 3,
      template_mode: initialTemplate?.latest_published_revision_mode || 'structured',
      structure: getInitialStructure(initialTemplate),
    },
  });

  const { fields, append, remove, move, replace } = useFieldArray({
    control,
    name: 'structure',
  });

  const createNoteTemplate = useCreateNoteTemplate();
  const updateNoteTemplate = useUpdateNoteTemplate();
  const isSaving = initialTemplate ? updateNoteTemplate.isPending : createNoteTemplate.isPending;

  const visibility = watch('visibility');
  const watchedStructure = watch('structure') || [];
  const category = watch('category');

  const categoryLabel = useMemo(() => {
    return CATEGORY_OPTIONS.find((option) => option.value === category)?.label || 'Custom';
  }, [category]);

  const validateStep = async (step) => {
    if (step === 1) {
      const isBasicValid = await trigger(['title', 'estimated_steps']);
      if (!isBasicValid) {
        toast.error('Complete required basic fields before continuing.');
        return false;
      }

      const title = getValues('title')?.trim();
      if (!title) {
        toast.error('Template title is required.');
        return false;
      }

      return true;
    }

    if (step === 2) {
      if (getValues('visibility') === 'department') {
        const hasDepartment = await trigger('department');
        if (!hasDepartment) {
          toast.error('Department is required for department visibility.');
          return false;
        }
      }

      return true;
    }

    if (step === 3) {
      const structure = getValues('structure') || [];

      if (!structure.length) {
        toast.error('Add at least one section to the template.');
        return false;
      }

      if (structure.some((section) => !section.section?.trim())) {
        toast.error('Every section must have a name.');
        return false;
      }

      if (structure.some((section) => section.type === 'observation' && !section.observation_type)) {
        toast.error('Observation sections must include an observation type.');
        return false;
      }

      return true;
    }

    return true;
  };

  const goToStep = async (targetStep) => {
    if (targetStep > currentStep) {
      const isCurrentStepValid = await validateStep(currentStep);
      if (!isCurrentStepValid) {
        return;
      }
    }

    setCurrentStep(targetStep);
  };

  const nextStep = () => {
    if (currentStep < STEPS.length) {
      void goToStep(currentStep + 1);
    }
  };

  const previousStep = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const addSection = () => {
    append({ section: '', type: 'text', required: false, observation_type: '', default_text: '' });
  };

  const applyQuickStart = (quickStartValue) => {
    const template = QUICK_STARTS.find((item) => item.value === quickStartValue);
    if (!template) {
      return;
    }

    replace(template.sections);
    setValue('category', template.category, { shouldDirty: true });
    setValue('estimated_steps', template.estimatedSteps, { shouldDirty: true });
    toast.success(`${template.label} structure applied.`);
  };

  const onSubmit = async (data) => {
    const isReadyToSave =
      (await validateStep(1)) &&
      (await validateStep(2)) &&
      (await validateStep(3));

    if (!isReadyToSave) {
      return;
    }

    const formattedData = {
      ...data,
      title: data.title.trim(),
      department: data.visibility === 'department' ? (data.department || '').trim() : '',
      template_mode: data.template_mode || 'structured',
      structure: {
        sections: data.structure.map((section) => ({
          name: section.section.trim(),
          type: section.type || 'text',
          required: section.required ?? false,
          ...(section.default_text?.trim()
            ? { default_text: section.default_text.trim() }
            : {}),
          ...(section.type === 'observation' && section.observation_type
            ? { observationType: section.observation_type }
            : {}),
        })),
      },
    };

    try {
      if (initialTemplate) {
        await updateNoteTemplate.mutateAsync({
          id: initialTemplate.id,
          data: formattedData,
        });
      } else {
        await createNoteTemplate.mutateAsync(formattedData);
      }

      onSuccess?.();
    } catch (error) {
      toast.error(initialTemplate ? 'Failed to update template.' : 'Failed to create template.');
      console.error('Error saving note template:', error);
    }
  };

  return (
    <div className="border border-border rounded-2xl bg-card overflow-hidden">
      <div className="p-4 sm:px-6 border-b border-border bg-muted/30">
        <div className="flex items-center justify-center gap-1 sm:gap-2">
          {STEPS.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;
            const isConnectorCompleted = currentStep >= step.id;

            return (
              <div key={step.id} className="flex items-center">
                {index > 0 ? (
                  <div
                    className={cn(
                      'h-px w-6 sm:w-10 mx-1 sm:mx-2',
                      isConnectorCompleted ? 'bg-amber-500' : 'bg-border',
                    )}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    void goToStep(step.id);
                  }}
                  className={cn(
                    'flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg transition-all',
                    isActive ? 'bg-amber-100 dark:bg-amber-900/30' : 'hover:bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'size-6 rounded-full flex items-center justify-center text-[10px] font-mono',
                      isCompleted || isActive
                        ? 'bg-amber-500 text-white'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {isCompleted ? <Check className="size-3.5" /> : step.id}
                  </span>
                  <span
                    className={cn(
                      'hidden sm:inline font-mono text-xs',
                      isActive ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {step.name}
                  </span>
                  <StepIcon className="sm:hidden size-3.5 text-muted-foreground" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="p-4 sm:p-6 space-y-6 min-h-[420px]">
          {currentStep === 1 ? (
            <section className="space-y-5 animate-chronicle-enter">
              <div>
                <h2 className="font-display text-xl text-foreground">Template Basics</h2>
                <p className="font-mono text-xs text-muted-foreground mt-1">
                  Define identity and workflow intent for this note template.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="title" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Template Title *
                </Label>
                <Input
                  id="title"
                  {...register('title', { required: true })}
                  placeholder="e.g., SOAP Note, Nursing Shift Note"
                  className="font-mono"
                />
                {errors.title ? <p className="text-xs text-rose-600">Template title is required.</p> : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Description
                </Label>
                <Textarea
                  id="description"
                  {...register('description')}
                  placeholder="Describe when this template should be used."
                  rows={3}
                  className="font-mono text-sm resize-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Category
                  </Label>
                  <Select
                    value={watch('category')}
                    onValueChange={(value) => setValue('category', value, { shouldDirty: true })}
                  >
                    <SelectTrigger className="font-mono">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORY_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        return (
                          <SelectItem key={option.value} value={option.value} className="font-mono">
                            <div className="flex items-center gap-2">
                              <Icon className="size-4" />
                              <span>{option.label}</span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Icon
                  </Label>
                  <Select
                    value={watch('icon')}
                    onValueChange={(value) => setValue('icon', value, { shouldDirty: true })}
                  >
                    <SelectTrigger className="font-mono">
                      <SelectValue placeholder="Select icon" />
                    </SelectTrigger>
                    <SelectContent>
                      {ICON_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="font-mono">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Template Mode
                  </Label>
                  <Select
                    value={watch('template_mode')}
                    onValueChange={(value) => setValue('template_mode', value, { shouldDirty: true })}
                  >
                    <SelectTrigger className="font-mono">
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_MODE_OPTIONS.map((modeOption) => (
                        <SelectItem key={modeOption.value} value={modeOption.value} className="font-mono">
                          {modeOption.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2 max-w-sm">
                <Label htmlFor="estimated_steps" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Estimated Steps
                </Label>
                <Input
                  id="estimated_steps"
                  type="number"
                  min="1"
                  max="10"
                  className="font-mono"
                  {...register('estimated_steps', {
                    valueAsNumber: true,
                    required: true,
                    min: 1,
                    max: 10,
                  })}
                />
                {errors.estimated_steps ? (
                  <p className="text-xs text-rose-600">Estimated steps must be between 1 and 10.</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {currentStep === 2 ? (
            <section className="space-y-5 animate-chronicle-enter">
              <div>
                <h2 className="font-display text-xl text-foreground">Visibility & Status</h2>
                <p className="font-mono text-xs text-muted-foreground mt-1">
                  Control who can discover and apply this template.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {VISIBILITY_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const isSelected = visibility === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setValue('visibility', option.value, { shouldDirty: true })}
                      className={cn(
                        'p-4 rounded-xl border text-left transition-all',
                        isSelected
                          ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                          : 'border-border hover:border-primary/30',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            'mt-0.5 p-1.5 rounded-md',
                            isSelected ? 'bg-amber-500 text-white' : 'bg-muted text-muted-foreground',
                          )}
                        >
                          <Icon className="size-3.5" />
                        </span>
                        <div>
                          <p className="font-mono text-sm text-foreground">{option.label}</p>
                          <p className="font-mono text-[11px] text-muted-foreground mt-1">{option.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {visibility === 'department' ? (
                <div className="space-y-2 max-w-md">
                  <Label htmlFor="department" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Department *
                  </Label>
                  <Input
                    id="department"
                    {...register('department', {
                      validate: (value) => {
                        if (watch('visibility') !== 'department') {
                          return true;
                        }
                        return Boolean(value?.trim());
                      },
                    })}
                    placeholder="e.g., Cardiology, Emergency, Nursing"
                    className="font-mono"
                  />
                  {errors.department ? (
                    <p className="text-xs text-rose-600">Department is required for department visibility.</p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card/50">
                <div>
                  <p className="font-mono text-sm text-foreground">Active Template</p>
                  <p className="font-mono text-[11px] text-muted-foreground mt-1">
                    Inactive templates are hidden from routine template selection.
                  </p>
                </div>
                <Switch
                  id="is_active"
                  checked={Boolean(watch('is_active'))}
                  onCheckedChange={(checked) => setValue('is_active', checked, { shouldDirty: true })}
                />
              </div>
            </section>
          ) : null}

          {currentStep === 3 ? (
            <section className="space-y-5 animate-chronicle-enter">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl text-foreground">Template Structure</h2>
                  <p className="font-mono text-xs text-muted-foreground mt-1">
                    Build the section flow clinicians will complete at bedside.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
                  onClick={addSection}
                >
                  <PlusCircle className="size-3.5 mr-1.5" />
                  Add Section
                </Button>
              </div>

              <div className="rounded-xl border border-border p-4 bg-muted/20">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="size-4 text-amber-600" />
                  <p className="font-mono text-xs text-foreground">Quick Start</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {QUICK_STARTS.map((template) => (
                    <Button
                      key={template.value}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="font-mono text-[11px]"
                      onClick={() => applyQuickStart(template.value)}
                    >
                      {template.label}
                    </Button>
                  ))}
                </div>
              </div>

              {fields.length === 0 ? (
                <div className="text-center py-12 rounded-xl border border-dashed border-border">
                  <ListOrdered className="size-10 mx-auto text-muted-foreground opacity-60" />
                  <p className="font-mono text-sm text-muted-foreground mt-3">No sections added yet.</p>
                  <p className="font-mono text-[11px] text-muted-foreground mt-1">
                    Add a section or apply a quick start template.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {fields.map((field, index) => {
                    const currentType = watch(`structure.${index}.type`) || 'text';
                    const isObservation = currentType === 'observation';

                    return (
                      <div key={field.id} className="relative rounded-xl border border-border bg-card/60 p-4 sm:p-5">
                        <div className="absolute top-3 right-3 flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => move(index, Math.max(index - 1, 0))}
                            disabled={index === 0}
                          >
                            <MoveUp className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => move(index, Math.min(index + 1, fields.length - 1))}
                            disabled={index === fields.length - 1}
                          >
                            <MoveDown className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 text-rose-500 hover:text-rose-600"
                            onClick={() => remove(index)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label
                              htmlFor={`structure.${index}.section`}
                              className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                            >
                              Section Name *
                            </Label>
                            <Input
                              id={`structure.${index}.section`}
                              {...register(`structure.${index}.section`, { required: true })}
                              placeholder="e.g., Chief Complaint, Examination"
                              className="font-mono"
                            />
                            {errors.structure?.[index]?.section ? (
                              <p className="text-xs text-rose-600">Section name is required.</p>
                            ) : null}
                          </div>

                          <div className="space-y-2">
                            <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                              Section Type
                            </Label>
                            <Select
                              value={currentType}
                              onValueChange={(value) => {
                                setValue(`structure.${index}.type`, value, { shouldDirty: true });
                                if (value !== 'observation') {
                                  setValue(`structure.${index}.observation_type`, '', { shouldDirty: true });
                                }
                              }}
                            >
                              <SelectTrigger className="font-mono">
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                              <SelectContent>
                                {SECTION_TYPES.map((typeOption) => (
                                  <SelectItem key={typeOption.value} value={typeOption.value} className="font-mono">
                                    {typeOption.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {isObservation ? (
                            <div className="space-y-2 md:col-span-2">
                              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                Observation Type
                              </Label>
                              <Select
                                value={watch(`structure.${index}.observation_type`) || undefined}
                                onValueChange={(value) =>
                                  setValue(`structure.${index}.observation_type`, value, { shouldDirty: true })
                                }
                              >
                                <SelectTrigger className="font-mono">
                                  <SelectValue placeholder="Select observation type" />
                                </SelectTrigger>
                                <SelectContent>
                                  {OBSERVATION_TYPES.map((observationOption) => (
                                    <SelectItem
                                      key={observationOption.value}
                                      value={observationOption.value}
                                      className="font-mono"
                                    >
                                      {observationOption.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}

                          <div className="space-y-2 md:col-span-2">
                            <Label
                              htmlFor={`structure.${index}.default_text`}
                              className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                            >
                              Starter Text
                            </Label>
                            <Textarea
                              id={`structure.${index}.default_text`}
                              {...register(`structure.${index}.default_text`)}
                              rows={3}
                              placeholder="Optional default wording. Supports placeholders like {{patient_name}}, {{age}}, {{today}}."
                              className="font-mono text-xs resize-none"
                            />
                          </div>

                          <div className="md:col-span-2 flex items-center justify-between rounded-lg border border-border bg-muted/20 p-3">
                            <div>
                              <p className="font-mono text-xs text-foreground">Required Section</p>
                              <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                                Clinicians must complete this section before signing.
                              </p>
                            </div>
                            <Switch
                              checked={Boolean(watch(`structure.${index}.required`))}
                              onCheckedChange={(checked) =>
                                setValue(`structure.${index}.required`, checked, { shouldDirty: true })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}

          {currentStep === 4 ? (
            <section className="space-y-5 animate-chronicle-enter">
              <div>
                <h2 className="font-display text-xl text-foreground">Review Template</h2>
                <p className="font-mono text-xs text-muted-foreground mt-1">
                  Final check before saving this chronicle workflow.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-border bg-card/60 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Title</p>
                  <p className="font-display text-lg text-foreground mt-1">{watch('title') || 'Untitled Template'}</p>
                  <p className="font-mono text-xs text-muted-foreground mt-2">Category: {categoryLabel}</p>
                </div>

                <div className="rounded-xl border border-border bg-card/60 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Access</p>
                  <p className="font-mono text-sm text-foreground mt-1">{visibility || 'private'}</p>
                  <p className="font-mono text-xs text-muted-foreground mt-2">
                    {watch('is_active') ? 'Active and selectable' : 'Inactive after save'}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground mt-2">
                    Mode: {watch('template_mode') || 'structured'}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                  <div>
                    <p className="font-mono text-xs text-foreground">Sections</p>
                    <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
                      {watchedStructure.length} section{watchedStructure.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 text-[10px] font-mono">
                    <CircleDot className="size-3" />
                    {watch('estimated_steps') || 0} steps
                  </span>
                </div>

                <div className="p-3 sm:p-4 space-y-2">
                  {watchedStructure.length === 0 ? (
                    <p className="font-mono text-xs text-muted-foreground">No sections configured.</p>
                  ) : (
                    fields.map((field, index) => {
                      const section = watchedStructure[index] || field;

                      return (
                        <div
                          key={field.id}
                          className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-3"
                        >
                          <div>
                            <p className="font-mono text-sm text-foreground">
                              {section.section || `Section ${index + 1}`}
                            </p>
                            <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                              {section.type}
                              {section.type === 'observation' && section.observation_type
                                ? ` · ${section.observation_type}`
                                : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {section.default_text?.trim() ? (
                              <span className="font-mono text-[10px] text-amber-700 bg-amber-500/10 px-2 py-1 rounded">
                                Starter text
                              </span>
                            ) : null}
                            {section.required ? (
                              <span className="font-mono text-[10px] text-rose-600 bg-rose-500/10 px-2 py-1 rounded">
                                Required
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <div className="p-4 sm:px-6 border-t border-border bg-card">
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={previousStep}
              disabled={currentStep === 1}
              className="font-mono text-xs"
            >
              <ChevronLeft className="size-3.5 mr-1" />
              Previous
            </Button>

            <div className="flex items-center gap-2">
              {isDirty ? <span className="font-mono text-[10px] text-muted-foreground hidden sm:inline">Unsaved changes</span> : null}
              {currentStep < STEPS.length ? (
                <Button
                  type="button"
                  size="sm"
                  className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
                  onClick={nextStep}
                >
                  Next
                  <ChevronRight className="size-3.5 ml-1" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSaving}
                  className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Check className="size-3.5 mr-1.5" />
                      {initialTemplate ? 'Update Template' : 'Create Template'}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};

export default TemplateBuilder;
