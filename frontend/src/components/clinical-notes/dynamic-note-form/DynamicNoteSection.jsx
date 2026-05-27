import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

import {
  FLUID_INTAKE_FIELDS,
  FLUID_OUTPUT_FIELDS,
  MEDICATION_FIELDS,
  VITAL_FIELDS,
} from './dynamicNoteFields';
import { getSectionName } from './dynamicNoteSectionUtils';

function getObservationType(section = {}) {
  return section.observation_type || section.observationType;
}

export function DynamicNoteSection({
  section,
  index,
  errors,
  register,
  onTextSectionChange,
  onNestedChange,
}) {
  const sectionName = getSectionName(section, index);
  const observationType = getObservationType(section);

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-medium">{sectionName}</h3>
      <Separator />

      <DynamicSectionFields
        section={section}
        sectionName={sectionName}
        observationType={observationType}
        register={register}
        onTextSectionChange={onTextSectionChange}
        onNestedChange={onNestedChange}
      />

      {errors[sectionName] && (
        <p className="text-red-500 text-sm">This field is required</p>
      )}
    </div>
  );
}

function DynamicSectionFields({
  section,
  sectionName,
  observationType,
  register,
  onTextSectionChange,
  onNestedChange,
}) {
  if (section.type === 'text') {
    return (
      <ClinicalTextarea
        sectionName={sectionName}
        placeholder={`Enter ${sectionName.toLowerCase()}`}
        register={register}
        onTextSectionChange={onTextSectionChange}
      />
    );
  }

  if (section.type === 'observation' && observationType === 'vitals') {
    return (
      <NestedFieldGrid
        sectionName={sectionName}
        fields={VITAL_FIELDS}
        onNestedChange={onNestedChange}
      />
    );
  }

  if (section.type === 'observation' && observationType === 'fluid_balance') {
    return (
      <FluidBalanceFields
        sectionName={sectionName}
        onNestedChange={onNestedChange}
      />
    );
  }

  if (section.type === 'observation' && observationType === 'subjective_symptoms') {
    return (
      <ClinicalTextarea
        sectionName={sectionName}
        placeholder="Enter symptoms, separated by commas"
        register={register}
        onTextSectionChange={onTextSectionChange}
      />
    );
  }

  if (section.type === 'observation' && observationType === 'allergy') {
    return (
      <ClinicalTextarea
        sectionName={sectionName}
        placeholder="Enter allergies, separated by commas"
        register={register}
        onTextSectionChange={onTextSectionChange}
      />
    );
  }

  if (section.type === 'condition') {
    return (
      <ClinicalTextarea
        sectionName={sectionName}
        placeholder="Enter diagnosis or condition"
        register={register}
        onTextSectionChange={onTextSectionChange}
      />
    );
  }

  if (section.type === 'medication_administration') {
    return (
      <div className="space-y-4">
        <NestedFieldGrid
          sectionName={sectionName}
          fields={MEDICATION_FIELDS}
          onNestedChange={onNestedChange}
        />
      </div>
    );
  }

  return null;
}

function ClinicalTextarea({ sectionName, placeholder, register, onTextSectionChange }) {
  return (
    <Textarea
      {...register(sectionName, { required: true })}
      placeholder={placeholder}
      className="min-h-[100px]"
      onChange={(event) => onTextSectionChange(sectionName, event.target.value)}
    />
  );
}

function FluidBalanceFields({ sectionName, onNestedChange }) {
  return (
    <div className="space-y-6">
      <NestedFieldSection
        title="Fluid Intake"
        sectionName={sectionName}
        fields={FLUID_INTAKE_FIELDS}
        onNestedChange={onNestedChange}
      />
      <NestedFieldSection
        title="Fluid Output"
        sectionName={sectionName}
        fields={FLUID_OUTPUT_FIELDS}
        onNestedChange={onNestedChange}
      />
    </div>
  );
}

function NestedFieldSection({ title, sectionName, fields, onNestedChange }) {
  return (
    <div>
      <h4 className="font-medium mb-2">{title}</h4>
      <NestedFieldGrid
        sectionName={sectionName}
        fields={fields}
        onNestedChange={onNestedChange}
      />
    </div>
  );
}

function NestedFieldGrid({ sectionName, fields, onNestedChange }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {fields.map((field) => (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={`${sectionName}-${field.idSuffix}`}>{field.label}</Label>
          <Input
            id={`${sectionName}-${field.idSuffix}`}
            type={field.type}
            step={field.step}
            placeholder={field.placeholder}
            onChange={(event) => onNestedChange(sectionName, field.name, event.target.value)}
          />
        </div>
      ))}
    </div>
  );
}
