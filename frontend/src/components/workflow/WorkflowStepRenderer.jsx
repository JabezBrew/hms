import React from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { cn } from '@/lib/utils';

const DEFAULT_EMPTY_OBJECT = {};

/**
 * WorkflowStepRenderer - Dynamically renders form fields based on workflow step definition
 *
 * @param {Object} props
 * @param {Object} props.stepDefinition - Step definition with fields array
 * @param {Object} props.values - Current form values
 * @param {Function} props.onChange - Callback when values change
 * @param {Object} props.contextData - Additional context data (e.g., prep_data)
 * @param {Object} props.errors - Validation errors
 */
export default function WorkflowStepRenderer({
  stepDefinition,
  values = DEFAULT_EMPTY_OBJECT,
  onChange,
  contextData = DEFAULT_EMPTY_OBJECT,
  errors = DEFAULT_EMPTY_OBJECT,
}) {
  if (!stepDefinition || !stepDefinition.fields) {
    return <div className="text-muted-foreground">No fields defined for this step</div>;
  }

  const handleFieldChange = (fieldName, value) => {
    onChange({
      ...values,
      [fieldName]: value,
    });
  };

  const renderField = (field) => {
    const fieldValue = values[field.name] ?? field.default_value ?? '';
    const fieldError = errors[field.name];

    const fieldWrapper = (children) => (
      <div key={field.name} className="space-y-2">
        <Label htmlFor={field.name} className="font-heading text-sm font-medium">
          {field.label || field.name}
          {field.required && <span className="text-rose-400 ml-1">*</span>}
        </Label>
        {field.help_text && (
          <p className="text-xs text-muted-foreground">{field.help_text}</p>
        )}
        {children}
        {fieldError && (
          <p className="text-xs text-rose-400">{fieldError}</p>
        )}
      </div>
    );

    switch (field.field_type) {
      case 'text':
      case 'email':
      case 'url':
        return fieldWrapper(
          <Input
            id={field.name}
            type={field.field_type}
            value={fieldValue}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
            disabled={field.read_only}
            className={cn(fieldError && 'border-rose-400')}
          />
        );

      case 'number':
      case 'decimal':
        return fieldWrapper(
          <Input
            id={field.name}
            type="number"
            value={fieldValue}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            step={field.field_type === 'decimal' ? '0.01' : '1'}
            min={field.min_value}
            max={field.max_value}
            required={field.required}
            disabled={field.read_only}
            className={cn(fieldError && 'border-rose-400')}
          />
        );

      case 'textarea':
        return fieldWrapper(
          <Textarea
            id={field.name}
            value={fieldValue}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
            disabled={field.read_only}
            rows={4}
            className={cn(fieldError && 'border-rose-400')}
          />
        );

      case 'richtext':
        // For now, use textarea. Can be replaced with rich text editor later
        return fieldWrapper(
          <Textarea
            id={field.name}
            value={fieldValue}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
            disabled={field.read_only}
            rows={6}
            className={cn('font-mono text-sm', fieldError && 'border-rose-400')}
          />
        );

      case 'checkbox':
        return fieldWrapper(
          <div className="flex items-center gap-x-2">
            <Checkbox
              id={field.name}
              checked={fieldValue === true || fieldValue === 'true'}
              onCheckedChange={(checked) => handleFieldChange(field.name, checked)}
              disabled={field.read_only}
            />
            <label
              htmlFor={field.name}
              className="text-sm text-muted-foreground cursor-pointer"
            >
              {field.placeholder || 'Check to confirm'}
            </label>
          </div>
        );

      case 'select':
      case 'choice':
        return fieldWrapper(
          <Select
            value={fieldValue}
            onValueChange={(value) => handleFieldChange(field.name, value)}
            disabled={field.read_only}
          >
            <SelectTrigger className={cn(fieldError && 'border-rose-400')}>
              <SelectValue placeholder={field.placeholder || 'Select an option'} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'radio':
        return fieldWrapper(
          <RadioGroup
            value={fieldValue}
            onValueChange={(value) => handleFieldChange(field.name, value)}
            disabled={field.read_only}
          >
            <div className="space-y-2">
              {field.options?.map((option) => (
                <div key={option} className="flex items-center gap-x-2">
                  <RadioGroupItem value={option} id={`${field.name}-${option}`} />
                  <Label
                    htmlFor={`${field.name}-${option}`}
                    className="font-normal text-sm cursor-pointer"
                  >
                    {option}
                  </Label>
                </div>
              ))}
            </div>
          </RadioGroup>
        );

      case 'date':
        return fieldWrapper(
          <Input
            id={field.name}
            type="date"
            value={fieldValue}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            required={field.required}
            disabled={field.read_only}
            className={cn(fieldError && 'border-rose-400')}
          />
        );

      case 'time':
        return fieldWrapper(
          <Input
            id={field.name}
            type="time"
            value={fieldValue}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            required={field.required}
            disabled={field.read_only}
            className={cn(fieldError && 'border-rose-400')}
          />
        );

      case 'datetime':
        return fieldWrapper(
          <DateTimePicker
            value={fieldValue ? new Date(fieldValue) : undefined}
            onChange={(date) => handleFieldChange(field.name, date?.toISOString())}
            disabled={field.read_only}
          />
        );

      case 'divider':
        return (
          <div key={field.name} className="border-t border-border my-6">
            {field.label && (
              <p className="font-heading text-sm font-medium text-muted-foreground mt-2">
                {field.label}
              </p>
            )}
          </div>
        );

      case 'info':
        return (
          <div key={field.name} className="rounded-lg bg-muted p-4">
            {field.label && (
              <h4 className="font-heading text-sm font-semibold mb-1">{field.label}</h4>
            )}
            <p className="text-sm text-muted-foreground">{field.help_text}</p>
          </div>
        );

      default:
        return (
          <div key={field.name} className="text-sm text-muted-foreground">
            Unsupported field type: {field.field_type}
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Context data display (e.g., prep data) */}
      {contextData.prep_data && (
        <div className="rounded-xl border border-border bg-card/50 p-4 mb-6">
          <h3 className="font-heading text-sm font-semibold mb-3 text-muted-foreground uppercase">
            Pre-loaded Information
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {Object.entries(contextData.prep_data).map(([key, value]) => (
              <div key={key} className="space-y-1">
                <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wide">
                  {key.replace(/_/g, ' ')}
                </span>
                <div className="font-mono text-sm text-foreground">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Render all fields */}
      {stepDefinition.fields.map(renderField)}
    </div>
  );
}
