import { useForm, useFieldArray } from 'react-hook-form';
import { useCreateNoteTemplate, useUpdateNoteTemplate } from '@/hooks/useClinicalNotesQueries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  PlusCircle, Trash2, MoveUp, MoveDown, Lock, Users, Building2, Globe,
  FileText, ClipboardList, Activity, UserPlus, LogOut, Heart, Stethoscope, Folder
} from 'lucide-react';

// Visibility options with icons and descriptions
const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private', icon: Lock, description: 'Only you can see and use this template' },
  { value: 'role', label: 'My Role', icon: Users, description: 'Shared with others in your role (e.g., all doctors)' },
  { value: 'department', label: 'Department', icon: Building2, description: 'Shared with your department members' },
  { value: 'public', label: 'Public', icon: Globe, description: 'Available to all users' },
];

// Category options with icons
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

// Icon options for template display
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

/**
 * Component for building and saving note templates
 * Supports visibility controls, categories, and custom sections
 */
const TemplateBuilder = ({ onSuccess, initialTemplate = null }) => {
  // Handle both array and object structure formats
  const getInitialStructure = () => {
    if (!initialTemplate?.structure) return [];
    if (Array.isArray(initialTemplate.structure)) return initialTemplate.structure;
    if (initialTemplate.structure.sections) {
      // Convert new format to old format for the form
      return initialTemplate.structure.sections.map(section => ({
        section: section.name || section.section || '',
        type: section.type || 'text',
        observation_type: section.observationType || section.observation_type || null,
      }));
    }
    return [];
  };

  const { register, control, handleSubmit, setValue, watch, formState: { errors } } = useForm({
    defaultValues: {
      title: initialTemplate?.title || '',
      description: initialTemplate?.description || '',
      is_active: initialTemplate?.is_active ?? true,
      visibility: initialTemplate?.visibility || 'private',
      department: initialTemplate?.department || '',
      category: initialTemplate?.category || 'custom',
      icon: initialTemplate?.icon || 'file-text',
      estimated_steps: initialTemplate?.estimated_steps || 3,
      structure: getInitialStructure()
    }
  });

  const visibility = watch('visibility');

  const { fields, append, remove, move } = useFieldArray({
    control,
    name: 'structure'
  });

  const createNoteTemplate = useCreateNoteTemplate();
  const updateNoteTemplate = useUpdateNoteTemplate();

  // Add a new section to the template
  const addSection = () => {
    append({ 
      section: '', 
      type: 'text'
    });
  };

  // Remove a section from the template
  const removeSection = (index) => {
    remove(index);
  };

  // Move a section up in the template
  const moveUp = (index) => {
    if (index > 0) {
      move(index, index - 1);
    }
  };

  // Move a section down in the template
  const moveDown = (index) => {
    if (index < fields.length - 1) {
      move(index, index + 1);
    }
  };

  // Handle form submission
  const onSubmit = async (data) => {
    try {
      // Validate that all sections have names
      const invalidSections = data.structure.filter(section => !section.section?.trim());
      if (invalidSections.length > 0) {
        toast.error('All sections must have a name');
        return;
      }

      // Convert form structure to the new format with sections array
      const formattedData = {
        ...data,
        structure: {
          sections: data.structure.map(section => ({
            name: section.section,
            type: section.type || 'text',
            required: section.required ?? false,
            ...(section.observation_type && { observationType: section.observation_type }),
          }))
        }
      };

      if (initialTemplate) {
        // Update existing template
        await updateNoteTemplate.mutateAsync({
          id: initialTemplate.id,
          data: formattedData
        });

        // Show success message
        toast.success('Template updated successfully');
      } else {
        // Create new template
        await createNoteTemplate.mutateAsync(formattedData);

        // Show success message
        toast.success('Template created successfully');
      }

      // Call onSuccess callback if provided
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      toast.error(initialTemplate ? 'Failed to update template' : 'Failed to create template');
      console.error('Error with template:', error);
    }
  };

  // Add predefined template structure
  const addPredefinedTemplate = (templateType) => {
    let templateStructure = [];

    if (templateType === 'soap') {
      templateStructure = [
        { section: 'Subjective', type: 'text' },
        { section: 'Objective', type: 'observation', observation_type: 'vitals' },
        { section: 'Assessment', type: 'condition' },
        { section: 'Plan', type: 'text' }
      ];
    } else if (templateType === 'hpi') {
      templateStructure = [
        { section: 'Presenting Complaint(s)', type: 'text' },
        { section: 'History of Presenting Complaints (HPC)', type: 'text' },
        { section: 'Review of Systems - CVS', type: 'text' },
        { section: 'Review of Systems - Respiratory', type: 'text' },
        { section: 'Review of Systems - Gastro', type: 'text' },
        { section: 'Review of Systems - Genitourinary', type: 'text' },
        { section: 'Review of Systems - MSK', type: 'text' },
        { section: 'Review of Systems - Neuro', type: 'text' },
        { section: 'Past Medical History', type: 'text' },
        { section: 'Drug History', type: 'text' },
        { section: 'Drug and Food Allergies', type: 'observation', observation_type: 'allergy' },
        { section: 'Family History', type: 'text' },
        { section: 'Social History', type: 'text' },
        { section: 'Physical Examination - General', type: 'text' },
        { section: 'Physical Examination - CVS', type: 'text' },
        { section: 'Physical Examination - Respiratory', type: 'text' },
        { section: 'Physical Examination - Gastrointestinal', type: 'text' },
        { section: 'Physical Examination - Neurological', type: 'text' },
        { section: 'Plan - Investigations', type: 'text' },
        { section: 'Plan - Management', type: 'text' }
      ];
    } else if (templateType === 'nursing_vitals') {
      templateStructure = [
        { section: 'Vitals', type: 'observation', observation_type: 'vitals' },
        { section: 'Notes', type: 'text' }
      ];
    } else if (templateType === 'nursing_io') {
      templateStructure = [
        { section: 'I/O Chart', type: 'observation', observation_type: 'fluid_balance' },
        { section: 'Notes', type: 'text' }
      ];
    } else if (templateType === 'nursing_meds') {
      templateStructure = [
        { section: 'Medication Given', type: 'medication_administration' },
        { section: 'Notes', type: 'text' }
      ];
    } else if (templateType === 'nursing_note') {
      templateStructure = [
        { section: 'Nurse Note', type: 'text' }
      ];
    }

    // Clear existing structure and add the predefined template
    setValue('structure', templateStructure);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{initialTemplate ? 'Edit Template' : 'Create Template'}</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="title">Template Title</Label>
            <Input
              id="title"
              {...register('title', { required: true })}
              placeholder="e.g., SOAP Note, Nursing Note"
            />
            {errors.title && (
              <p className="text-red-500 text-sm">Title is required</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              {...register('description')}
              placeholder="Describe the purpose of this template"
            />
          </div>

          {/* Visibility and Category Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select
                defaultValue={watch('visibility')}
                onValueChange={(value) => setValue('visibility', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select visibility" />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    return (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span>{option.label}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {VISIBILITY_OPTIONS.find(o => o.value === visibility)?.description}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                defaultValue={watch('category')}
                onValueChange={(value) => setValue('category', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    return (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span>{option.label}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Department field (only shown when visibility is 'department') */}
          {visibility === 'department' && (
            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Input
                id="department"
                {...register('department', { required: visibility === 'department' })}
                placeholder="e.g., Cardiology, Emergency, Nursing"
              />
              {errors.department && (
                <p className="text-red-500 text-sm">Department is required for department-level sharing</p>
              )}
            </div>
          )}

          {/* Icon and Steps Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Icon</Label>
              <Select
                defaultValue={watch('icon')}
                onValueChange={(value) => setValue('icon', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select icon" />
                </SelectTrigger>
                <SelectContent>
                  {ICON_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="estimated_steps">Estimated Steps</Label>
              <Input
                id="estimated_steps"
                type="number"
                min="1"
                max="10"
                {...register('estimated_steps', { valueAsNumber: true, min: 1, max: 10 })}
              />
            </div>

            <div className="flex items-center space-x-2 pt-8">
              <Switch
                id="is_active"
                checked={watch('is_active')}
                onCheckedChange={(checked) => setValue('is_active', checked)}
              />
              <Label htmlFor="is_active">Active</Label>
            </div>
          </div>

          <Separator />

          {/* Predefined Templates */}
          <div className="space-y-2">
            <Label>Quick Start Templates</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Click to pre-fill the structure with a common template format
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addPredefinedTemplate('soap')}
              >
                SOAP
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addPredefinedTemplate('hpi')}
              >
                HPI
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addPredefinedTemplate('nursing_vitals')}
              >
                Nursing Vitals
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addPredefinedTemplate('nursing_io')}
              >
                Nursing I/O
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addPredefinedTemplate('nursing_meds')}
              >
                Nursing Meds
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addPredefinedTemplate('nursing_note')}
              >
                Nursing Note
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label>Template Structure</Label>
              <Button 
                type="button" 
                variant="outline" 
                size="sm"
                onClick={addSection}
              >
                <PlusCircle className="h-4 w-4 mr-2" />
                Add Section
              </Button>
            </div>

            {fields.length === 0 && (
              <p className="text-muted-foreground text-center py-4">
                No sections added yet. Add sections to build your template.
              </p>
            )}

            {fields.map((field, index) => (
              <Card key={field.id} className="relative">
                <CardContent className="pt-6 pb-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`structure.${index}.section`}>Section Name</Label>
                      <Input
                        id={`structure.${index}.section`}
                        {...register(`structure.${index}.section`, { required: true })}
                        placeholder="e.g., Chief Complaint, Vitals"
                      />
                      {errors.structure?.[index]?.section && (
                        <p className="text-red-500 text-sm">Section name is required</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`structure.${index}.type`}>Section Type</Label>
                      <Select
                        defaultValue={field.type}
                        onValueChange={(value) => setValue(`structure.${index}.type`, value)}
                      >
                        <SelectTrigger id={`structure.${index}.type`}>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Text</SelectItem>
                          <SelectItem value="observation">Observation</SelectItem>
                          <SelectItem value="condition">Condition</SelectItem>
                          <SelectItem value="medication_administration">Medication Administration</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {watch(`structure.${index}.type`) === 'observation' && (
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor={`structure.${index}.observation_type`}>Observation Type</Label>
                        <Select
                          defaultValue={field.observation_type}
                          onValueChange={(value) => setValue(`structure.${index}.observation_type`, value)}
                        >
                          <SelectTrigger id={`structure.${index}.observation_type`}>
                            <SelectValue placeholder="Select observation type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="vitals">Vitals</SelectItem>
                            <SelectItem value="subjective_symptoms">Subjective Symptoms</SelectItem>
                            <SelectItem value="allergy">Allergy</SelectItem>
                            <SelectItem value="fluid_balance">Fluid Balance</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <div className="absolute top-2 right-2 flex space-x-1">
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => moveUp(index)}
                      disabled={index === 0}
                    >
                      <MoveUp className="h-4 w-4" />
                    </Button>
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => moveDown(index)}
                      disabled={index === fields.length - 1}
                    >
                      <MoveDown className="h-4 w-4" />
                    </Button>
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => removeSection(index)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
        <CardFooter>
          <Button 
            type="submit" 
            disabled={(initialTemplate ? updateNoteTemplate.isPending : createNoteTemplate.isPending) || fields.length === 0}
            className="w-full md:w-auto"
          >
            {(initialTemplate ? updateNoteTemplate.isPending : createNoteTemplate.isPending) ? 'Saving...' : 'Save Template'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default TemplateBuilder;
