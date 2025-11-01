import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useCreateNoteEntry } from '@/hooks/useClinicalNotesQueries';
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

/**
 * Dynamic form component for clinical notes
 * Renders different form fields based on template structure
 */
const DynamicNoteForm = ({ 
  template, 
  encounterId, 
  onSuccess,
  isLoading = false
}) => {
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm();
  const createNoteEntry = useCreateNoteEntry();
  const [formData, setFormData] = useState({});

  // Initialize form data based on template structure
  useEffect(() => {
    if (template?.structure) {
      const initialData = {};
      template.structure.forEach(section => {
        if (section.type === 'observation' && section.observation_type === 'vitals') {
          initialData[section.section] = {
            heart_rate: '',
            respiratory_rate: '',
            temperature: '',
            blood_pressure_systolic: '',
            blood_pressure_diastolic: '',
            oxygen_saturation: ''
          };
        } else if (section.type === 'medication_administration') {
          initialData[section.section] = {
            medication: '',
            dosage: ''
          };
        } else if (section.type === 'observation' && section.observation_type === 'fluid_balance') {
          initialData[section.section] = {
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
          initialData[section.section] = '';
        }
      });
      setFormData(initialData);
    }
  }, [template]);

  // Handle form submission
  const onSubmit = async (data) => {
    try {
      // Prepare data for submission
      const noteData = {
        template: template.id,
        encounter_id: encounterId,
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
    setFormData(prev => ({
      ...prev,
      [section]: value
    }));
  };

  // Handle changes in nested form fields (e.g., vitals)
  const handleNestedChange = (section, field, value) => {
    const sectionData = watch(section) || {};
    const updatedData = {
      ...sectionData,
      [field]: value
    };
    setValue(section, updatedData);
    setFormData(prev => ({
      ...prev,
      [section]: updatedData
    }));
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
              <div key={index} className="space-y-2">
                <h3 className="text-lg font-medium">{section.section}</h3>
                <Separator />

                {/* Render different form fields based on section type */}
                {section.type === 'text' && (
                  <Textarea
                    {...register(section.section, { required: true })}
                    placeholder={`Enter ${section.section.toLowerCase()}`}
                    className="min-h-[100px]"
                    onChange={(e) => handleChange(section.section, e.target.value)}
                  />
                )}

                {section.type === 'observation' && section.observation_type === 'vitals' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={`${section.section}-heart-rate`}>Heart Rate (bpm)</Label>
                      <Input
                        id={`${section.section}-heart-rate`}
                        type="number"
                        placeholder="e.g., 72"
                        onChange={(e) => handleNestedChange(section.section, 'heart_rate', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`${section.section}-respiratory-rate`}>Respiratory Rate (breaths/min)</Label>
                      <Input
                        id={`${section.section}-respiratory-rate`}
                        type="number"
                        placeholder="e.g., 16"
                        onChange={(e) => handleNestedChange(section.section, 'respiratory_rate', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`${section.section}-temperature`}>Temperature (°C)</Label>
                      <Input
                        id={`${section.section}-temperature`}
                        type="number"
                        step="0.1"
                        placeholder="e.g., 37.0"
                        onChange={(e) => handleNestedChange(section.section, 'temperature', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`${section.section}-oxygen-saturation`}>Oxygen Saturation (%)</Label>
                      <Input
                        id={`${section.section}-oxygen-saturation`}
                        type="number"
                        placeholder="e.g., 98"
                        onChange={(e) => handleNestedChange(section.section, 'oxygen_saturation', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`${section.section}-bp-systolic`}>Blood Pressure (Systolic)</Label>
                      <Input
                        id={`${section.section}-bp-systolic`}
                        type="number"
                        placeholder="e.g., 120"
                        onChange={(e) => handleNestedChange(section.section, 'blood_pressure_systolic', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`${section.section}-bp-diastolic`}>Blood Pressure (Diastolic)</Label>
                      <Input
                        id={`${section.section}-bp-diastolic`}
                        type="number"
                        placeholder="e.g., 80"
                        onChange={(e) => handleNestedChange(section.section, 'blood_pressure_diastolic', e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {section.type === 'observation' && section.observation_type === 'fluid_balance' && (
                  <div className="space-y-6">
                    <div>
                      <h4 className="font-medium mb-2">Fluid Intake</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`${section.section}-oral-intake`}>Oral Intake (mL)</Label>
                          <Input
                            id={`${section.section}-oral-intake`}
                            type="number"
                            placeholder="e.g., 800"
                            onChange={(e) => handleNestedChange(section.section, 'oral_intake', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${section.section}-iv-intake`}>IV Fluids (mL)</Label>
                          <Input
                            id={`${section.section}-iv-intake`}
                            type="number"
                            placeholder="e.g., 500"
                            onChange={(e) => handleNestedChange(section.section, 'iv_intake', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${section.section}-ng-tube`}>NG Tube Feeding (mL)</Label>
                          <Input
                            id={`${section.section}-ng-tube`}
                            type="number"
                            placeholder="e.g., 300"
                            onChange={(e) => handleNestedChange(section.section, 'ng_tube', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${section.section}-tpn`}>TPN (mL)</Label>
                          <Input
                            id={`${section.section}-tpn`}
                            type="number"
                            placeholder="e.g., 250"
                            onChange={(e) => handleNestedChange(section.section, 'tpn', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${section.section}-other-intake`}>Other Intake (mL)</Label>
                          <Input
                            id={`${section.section}-other-intake`}
                            type="number"
                            placeholder="e.g., 100"
                            onChange={(e) => handleNestedChange(section.section, 'other_intake', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium mb-2">Fluid Output</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`${section.section}-urine`}>Urine Output (mL)</Label>
                          <Input
                            id={`${section.section}-urine`}
                            type="number"
                            placeholder="e.g., 1200"
                            onChange={(e) => handleNestedChange(section.section, 'urine', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${section.section}-ng-aspirate`}>N/G Aspirate (mL)</Label>
                          <Input
                            id={`${section.section}-ng-aspirate`}
                            type="number"
                            placeholder="e.g., 50"
                            onChange={(e) => handleNestedChange(section.section, 'ng_aspirate', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${section.section}-drain-fluid`}>Fluid from Drains (mL)</Label>
                          <Input
                            id={`${section.section}-drain-fluid`}
                            type="number"
                            placeholder="e.g., 100"
                            onChange={(e) => handleNestedChange(section.section, 'drain_fluid', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${section.section}-stoma`}>Stoma Output (mL)</Label>
                          <Input
                            id={`${section.section}-stoma`}
                            type="number"
                            placeholder="e.g., 200"
                            onChange={(e) => handleNestedChange(section.section, 'stoma', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${section.section}-stool`}>Stool (mL)</Label>
                          <Input
                            id={`${section.section}-stool`}
                            type="number"
                            placeholder="e.g., 150"
                            onChange={(e) => handleNestedChange(section.section, 'stool', e.target.value)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${section.section}-other-output`}>Other Output (mL)</Label>
                          <Input
                            id={`${section.section}-other-output`}
                            type="number"
                            placeholder="e.g., 50"
                            onChange={(e) => handleNestedChange(section.section, 'other_output', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {section.type === 'observation' && section.observation_type === 'subjective_symptoms' && (
                  <Textarea
                    {...register(section.section, { required: true })}
                    placeholder="Enter symptoms, separated by commas"
                    className="min-h-[100px]"
                    onChange={(e) => handleChange(section.section, e.target.value)}
                  />
                )}

                {section.type === 'observation' && section.observation_type === 'allergy' && (
                  <Textarea
                    {...register(section.section, { required: true })}
                    placeholder="Enter allergies, separated by commas"
                    className="min-h-[100px]"
                    onChange={(e) => handleChange(section.section, e.target.value)}
                  />
                )}

                {section.type === 'condition' && (
                  <Textarea
                    {...register(section.section, { required: true })}
                    placeholder="Enter diagnosis or condition"
                    className="min-h-[100px]"
                    onChange={(e) => handleChange(section.section, e.target.value)}
                  />
                )}

                {section.type === 'medication_administration' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor={`${section.section}-medication`}>Medication</Label>
                      <Input
                        id={`${section.section}-medication`}
                        placeholder="e.g., Paracetamol"
                        onChange={(e) => handleNestedChange(section.section, 'medication', e.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`${section.section}-dosage`}>Dosage</Label>
                      <Input
                        id={`${section.section}-dosage`}
                        placeholder="e.g., 500mg, twice daily"
                        onChange={(e) => handleNestedChange(section.section, 'dosage', e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {errors[section.section] && (
                  <p className="text-red-500 text-sm">This field is required</p>
                )}
              </div>
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
