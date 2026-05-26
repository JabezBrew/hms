import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { useCreateNoteEntry } from '@/features/clinical-notes/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Combobox } from '@/components/ui/combobox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';

function getSectionName(section = {}, index = 0) {
  return section.section || section.name || `Section ${index + 1}`;
}

function getObservationType(section = {}) {
  return section.observation_type || section.observationType;
}

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
  const formDataRef = useRef({});

  // Initialize form data based on template structure
  useEffect(() => {
    if (template?.structure) {
      const initialData = {};
      template.structure.forEach((section, index) => {
        const sectionName = getSectionName(section, index);
        const observationType = getObservationType(section);

        if (section.type === 'observation' && observationType === 'vitals') {
          initialData[sectionName] = {
            heart_rate: '',
            respiratory_rate: '',
            temperature: '',
            blood_pressure_systolic: '',
            blood_pressure_diastolic: '',
            oxygen_saturation: ''
          };
        } else if (section.type === 'medication_administration') {
          initialData[sectionName] = {
            medication: '',
            dosage: ''
          };
        } else if (section.type === 'observation' && observationType === 'fluid_balance') {
          initialData[sectionName] = {
            // Input fields
            oral_intake: '',
            iv_intake: '',
            ng_tube: '',
            tpn: '',
            other_intake: '',
            // Output fields
            urine: '',
            ng_aspirate: '',
            drain_fluid: '',
            stoma: '',
            stool: '',
            other_output: ''
          };
        } else {
          initialData[sectionName] = '';
        }
      });
      formDataRef.current = initialData;
    }
  }, [template]);

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
        data: data
      };

      // Submit the note entry
      await createNoteEntry.mutateAsync(noteData);

      // Show success message
      toast.success('Clinical note submitted successfully');

      // Call onSuccess callback if provided
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      toast.error('Failed to submit clinical note');
      console.error('Error submitting note:', error);
    }
  };

  // Handle changes in form fields
  const handleChange = (section, value) => {
    setValue(section, value);
    formDataRef.current = {
      ...formDataRef.current,
      [section]: value
    };
  };

  // Handle changes in nested form fields (e.g., vitals)
  const handleNestedChange = (section, field, value) => {
    const sectionData = watch(section) || {};
    const updatedData = {
      ...sectionData,
      [field]: value
    };
    setValue(section, updatedData);
    formDataRef.current = {
      ...formDataRef.current,
      [section]: updatedData
    };
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
            {template.structure.map((section, index) => {
              const sectionName = getSectionName(section, index);
              const observationType = getObservationType(section);

              return (
              <div key={`${sectionName}-${index}`} className="space-y-2">
                <h3 className="text-lg font-medium">{sectionName}</h3>
                <Separator />

                {/* Render different form fields based on section type */}
                {section.type === 'text' && (
                  <Textarea
                    {...register(sectionName, { required: true })}
                    placeholder={`Enter ${sectionName.toLowerCase()}`}
                    className="min-h-[100px]"
                    onChange={(e) => handleChange(sectionName, e.target.value)}
                  />
                )}

                {section.type === 'observation' && observationType === 'vitals' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`${sectionName}-heart-rate`}>Heart Rate (bpm)</Label>
                      <Input
                        id={`${sectionName}-heart-rate`}
                        type="number"
                        placeholder="e.g., 72"
                        onChange={(e) => handleNestedChange(sectionName, 'heart_rate', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`${sectionName}-respiratory-rate`}>Respiratory Rate (breaths/min)</Label>
                      <Input
                        id={`${sectionName}-respiratory-rate`}
                        type="number"
                        placeholder="e.g., 16"
                        onChange={(e) => handleNestedChange(sectionName, 'respiratory_rate', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`${sectionName}-temperature`}>Temperature (°C)</Label>
                      <Input
                        id={`${sectionName}-temperature`}
                        type="number"
                        step="0.1"
                        placeholder="e.g., 37.0"
                        onChange={(e) => handleNestedChange(sectionName, 'temperature', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`${sectionName}-oxygen-saturation`}>Oxygen Saturation (%)</Label>
                      <Input
                        id={`${sectionName}-oxygen-saturation`}
                        type="number"
                        placeholder="e.g., 98"
                        onChange={(e) => handleNestedChange(sectionName, 'oxygen_saturation', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`${sectionName}-bp-systolic`}>Blood Pressure (Systolic)</Label>
                      <Input
                        id={`${sectionName}-bp-systolic`}
                        type="number"
                        placeholder="e.g., 120"
                        onChange={(e) => handleNestedChange(sectionName, 'blood_pressure_systolic', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`${sectionName}-bp-diastolic`}>Blood Pressure (Diastolic)</Label>
                      <Input
                        id={`${sectionName}-bp-diastolic`}
                        type="number"
                        placeholder="e.g., 80"
                        onChange={(e) => handleNestedChange(sectionName, 'blood_pressure_diastolic', e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {section.type === 'observation' && observationType === 'fluid_balance' && (
                  <div className="space-y-6">
                    <div>
                      <h4 className="font-medium mb-2">Fluid Intake</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`${sectionName}-oral-intake`}>Oral Intake (mL)</Label>
                          <Input
                            id={`${sectionName}-oral-intake`}
                            type="number"
                            placeholder="e.g., 800"
                            onChange={(e) => handleNestedChange(sectionName, 'oral_intake', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${sectionName}-iv-intake`}>IV Fluids (mL)</Label>
                          <Input
                            id={`${sectionName}-iv-intake`}
                            type="number"
                            placeholder="e.g., 500"
                            onChange={(e) => handleNestedChange(sectionName, 'iv_intake', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${sectionName}-ng-tube`}>NG Tube Feeding (mL)</Label>
                          <Input
                            id={`${sectionName}-ng-tube`}
                            type="number"
                            placeholder="e.g., 300"
                            onChange={(e) => handleNestedChange(sectionName, 'ng_tube', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${sectionName}-tpn`}>TPN (mL)</Label>
                          <Input
                            id={`${sectionName}-tpn`}
                            type="number"
                            placeholder="e.g., 250"
                            onChange={(e) => handleNestedChange(sectionName, 'tpn', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${sectionName}-other-intake`}>Other Intake (mL)</Label>
                          <Input
                            id={`${sectionName}-other-intake`}
                            type="number"
                            placeholder="e.g., 100"
                            onChange={(e) => handleNestedChange(sectionName, 'other_intake', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium mb-2">Fluid Output</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`${sectionName}-urine`}>Urine Output (mL)</Label>
                          <Input
                            id={`${sectionName}-urine`}
                            type="number"
                            placeholder="e.g., 1200"
                            onChange={(e) => handleNestedChange(sectionName, 'urine', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${sectionName}-ng-aspirate`}>N/G Aspirate (mL)</Label>
                          <Input
                            id={`${sectionName}-ng-aspirate`}
                            type="number"
                            placeholder="e.g., 50"
                            onChange={(e) => handleNestedChange(sectionName, 'ng_aspirate', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${sectionName}-drain-fluid`}>Fluid from Drains (mL)</Label>
                          <Input
                            id={`${sectionName}-drain-fluid`}
                            type="number"
                            placeholder="e.g., 100"
                            onChange={(e) => handleNestedChange(sectionName, 'drain_fluid', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${sectionName}-stoma`}>Stoma Output (mL)</Label>
                          <Input
                            id={`${sectionName}-stoma`}
                            type="number"
                            placeholder="e.g., 200"
                            onChange={(e) => handleNestedChange(sectionName, 'stoma', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${sectionName}-stool`}>Stool (mL)</Label>
                          <Input
                            id={`${sectionName}-stool`}
                            type="number"
                            placeholder="e.g., 150"
                            onChange={(e) => handleNestedChange(sectionName, 'stool', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${sectionName}-other-output`}>Other Output (mL)</Label>
                          <Input
                            id={`${sectionName}-other-output`}
                            type="number"
                            placeholder="e.g., 50"
                            onChange={(e) => handleNestedChange(sectionName, 'other_output', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {section.type === 'observation' && observationType === 'subjective_symptoms' && (
                  <Textarea
                    {...register(sectionName, { required: true })}
                    placeholder="Enter symptoms, separated by commas"
                    className="min-h-[100px]"
                    onChange={(e) => handleChange(sectionName, e.target.value)}
                  />
                )}

                {section.type === 'observation' && observationType === 'allergy' && (
                  <Textarea
                    {...register(sectionName, { required: true })}
                    placeholder="Enter allergies, separated by commas"
                    className="min-h-[100px]"
                    onChange={(e) => handleChange(sectionName, e.target.value)}
                  />
                )}

                {section.type === 'condition' && (
                  <Textarea
                    {...register(sectionName, { required: true })}
                    placeholder="Enter diagnosis or condition"
                    className="min-h-[100px]"
                    onChange={(e) => handleChange(sectionName, e.target.value)}
                  />
                )}

                {section.type === 'medication_administration' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor={`${sectionName}-medication`}>Medication</Label>
                      <Input
                        id={`${sectionName}-medication`}
                        placeholder="e.g., Paracetamol"
                        onChange={(e) => handleNestedChange(sectionName, 'medication', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`${sectionName}-dosage`}>Dosage</Label>
                      <Input
                        id={`${sectionName}-dosage`}
                        placeholder="e.g., 500mg, twice daily"
                        onChange={(e) => handleNestedChange(sectionName, 'dosage', e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {errors[sectionName] && (
                  <p className="text-red-500 text-sm">This field is required</p>
                )}
              </div>
              );
            })}
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
