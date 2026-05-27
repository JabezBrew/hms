import { useForm } from 'react-hook-form';
import { useCreateNoteEntry } from '@/features/clinical-notes/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';

import {
  DynamicNoteSection,
} from './dynamic-note-form/DynamicNoteSection';
import { getSectionName } from './dynamic-note-form/dynamicNoteSectionUtils';

/**
 * Dynamic form component for clinical notes
 * Renders different form fields based on template structure
 */
const DynamicNoteForm = ({
  template,
  encounterId,
  patientId,
  onSuccess,
  isLoading = false
}) => {
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm();
  const createNoteEntry = useCreateNoteEntry();

  // Handle form submission
  const onSubmit = async (data) => {
    try {
      // Prepare data for submission
      const noteData = {
        template: template.id,
        template_id: template.id,
        encounter: encounterId,
        patient: patientId,
        note_type: template.note_type || template.category,
        title: template.title,
        data
      };

      // Submit the note entry
      await createNoteEntry.mutateAsync(noteData);

      // Show success message
      toast.success('Clinical note submitted successfully');

      // Call onSuccess callback if provided
      if (onSuccess) {
        onSuccess();
      }
    } catch {
      toast.error('Failed to submit clinical note');
      console.error('Error submitting note');
    }
  };

  // Handle changes in form fields
  const updateTextSectionValue = (section, value) => {
    setValue(section, value);
  };

  // Handle changes in nested form fields (e.g., vitals)
  const handleNestedChange = (section, field, value) => {
    const sectionData = watch(section) || {};
    const updatedData = {
      ...sectionData,
      [field]: value
    };
    setValue(section, updatedData);
  };

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <Skeleton className="h-8 w-1/3" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
        <CardFooter>
          <Skeleton className="h-10 w-24" />
        </CardFooter>
      </Card>
    );
  }

  if (!template || !template.structure) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>No template selected</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Please select a template to create a clinical note.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{template.title}</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {template.structure.map((section, index) => (
              <DynamicNoteSection
                key={getSectionName(section, index)}
                section={section}
                index={index}
                errors={errors}
                register={register}
                onTextSectionChange={updateTextSectionValue}
                onNestedChange={handleNestedChange}
              />
            ))}
          </div>
        </CardContent>
        <CardFooter>
          <Button 
            type="submit" 
            disabled={createNoteEntry.isPending}
            className="w-full md:w-auto"
          >
            {createNoteEntry.isPending ? 'Submitting...' : 'Submit Note'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default DynamicNoteForm;
