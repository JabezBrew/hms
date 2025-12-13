/**
 * ChartFieldRenderer - Renders chart fields based on type
 *
 * Dynamic field renderer that handles all chart field types
 * with Chronicle Design System styling.
 */

import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, Info, Calculator } from "lucide-react";

/**
 * Main field renderer component
 */
const ChartFieldRenderer = ({
  field,
  value,
  onChange,
  error,
  disabled = false,
  showLabel = true,
  className,
  inSlideOver = false,
}) => {
  const config = field.config || {};

  // Check if value is in critical range
  const isCritical = useMemo(() => {
    if (!value || field.field_type !== 'numeric') return false;

    const numValue = parseFloat(value);
    if (isNaN(numValue)) return false;

    const { critical_low, critical_high } = config;
    if (critical_low !== undefined && numValue < critical_low) return true;
    if (critical_high !== undefined && numValue > critical_high) return true;

    return false;
  }, [value, field, config]);

  // Render the appropriate input based on field type
  const renderField = () => {
    switch (field.field_type) {
      case 'numeric':
        return (
          <NumericField
            field={field}
            value={value}
            onChange={onChange}
            disabled={disabled}
            isCritical={isCritical}
          />
        );

      case 'select':
        return (
          <SelectField
            field={field}
            value={value}
            onChange={onChange}
            disabled={disabled}
            inSlideOver={inSlideOver}
          />
        );

      case 'multi_select':
        return (
          <MultiSelectField
            field={field}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        );

      case 'scale':
        return (
          <ScaleField
            field={field}
            value={value}
            onChange={onChange}
            disabled={disabled}
            isCritical={isCritical}
          />
        );

      case 'text':
        return (
          <TextField
            field={field}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        );

      case 'textarea':
        return (
          <TextAreaField
            field={field}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        );

      case 'calculated':
        return (
          <CalculatedField
            field={field}
            value={value}
          />
        );

      case 'paired':
        return (
          <PairedField
            field={field}
            value={value}
            onChange={onChange}
            disabled={disabled}
            isCritical={isCritical}
          />
        );

      case 'time':
        return (
          <TimeField
            field={field}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        );

      case 'boolean':
        return (
          <BooleanField
            field={field}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        );

      default:
        return (
          <div className="text-muted-foreground text-sm">
            Unknown field type: {field.field_type}
          </div>
        );
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {showLabel && (
        <div className="flex items-center justify-between">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {field.name}
            {field.is_required && <span className="text-rose-500 ml-0.5">*</span>}
          </Label>
          {field.field_type === 'calculated' && (
            <Calculator className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
      )}

      {renderField()}

      {/* Help text */}
      {field.help_text && (
        <p className="flex items-start gap-1 text-[10px] text-muted-foreground">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          {field.help_text}
        </p>
      )}

      {/* Error */}
      {error && (
        <p className="flex items-center gap-1 text-[10px] text-rose-500">
          <AlertTriangle className="h-3 w-3" />
          {error}
        </p>
      )}

      {/* Critical warning */}
      {isCritical && (
        <p className="flex items-center gap-1 text-[10px] text-rose-500 font-medium animate-pulse">
          <AlertTriangle className="h-3 w-3" />
          Critical value
        </p>
      )}
    </div>
  );
};

/**
 * Numeric field with unit display
 */
const NumericField = ({ field, value, onChange, disabled, isCritical }) => {
  const config = field.config || {};
  const { unit, min, max, decimals = 0 } = config;

  return (
    <div className="relative">
      <Input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
        disabled={disabled}
        min={min}
        max={max}
        step={decimals > 0 ? Math.pow(10, -decimals) : 1}
        className={cn(
          "font-mono pr-12",
          isCritical && "border-rose-500 focus:ring-rose-500"
        )}
        placeholder={min !== undefined ? `${min} - ${max}` : 'Enter value'}
      />
      {unit && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">
          {unit}
        </span>
      )}
    </div>
  );
};

/**
 * Single select dropdown
 */
const SelectField = ({ field, value, onChange, disabled, inSlideOver }) => {
  const config = field.config || {};
  const options = config.options || [];

  return (
    <Select
      value={value ?? ''}
      onValueChange={(v) => onChange(v || null)}
      disabled={disabled}
    >
      <SelectTrigger className="font-mono">
        <SelectValue placeholder="Select..." />
      </SelectTrigger>
      <SelectContent className={cn(inSlideOver && "z-[200]")}>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="font-mono">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

/**
 * Multi-select checkboxes
 */
const MultiSelectField = ({ field, value, onChange, disabled }) => {
  const config = field.config || {};
  const options = config.options || [];
  const selectedValues = Array.isArray(value) ? value : [];

  const handleToggle = (optValue) => {
    if (selectedValues.includes(optValue)) {
      onChange(selectedValues.filter((v) => v !== optValue));
    } else {
      onChange([...selectedValues, optValue]);
    }
  };

  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <div key={opt.value} className="flex items-center gap-2">
          <Checkbox
            id={`${field.field_key}-${opt.value}`}
            checked={selectedValues.includes(opt.value)}
            onCheckedChange={() => handleToggle(opt.value)}
            disabled={disabled}
          />
          <label
            htmlFor={`${field.field_key}-${opt.value}`}
            className="font-mono text-sm cursor-pointer"
          >
            {opt.label}
          </label>
        </div>
      ))}
    </div>
  );
};

/**
 * Scale field (1-10, GCS subscales, etc.)
 */
const ScaleField = ({ field, value, onChange, disabled, isCritical }) => {
  const config = field.config || {};
  const { min = 1, max = 10, step = 1, labels = {} } = config;

  // Generate scale options
  const options = [];
  for (let i = min; i <= max; i += step) {
    options.push(i);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => !disabled && onChange(opt)}
            disabled={disabled}
            className={cn(
              "px-3 py-2 rounded-lg font-mono text-sm transition-all",
              "border-2 min-w-[44px]",
              value === opt
                ? isCritical
                  ? "border-rose-500 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                  : "border-primary bg-primary/10 text-primary"
                : "border-border hover:border-primary/50 text-muted-foreground hover:text-foreground",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {opt}
          </button>
        ))}
      </div>
      {/* Scale labels */}
      {Object.keys(labels).length > 0 && (
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
          {Object.entries(labels).map(([val, label]) => (
            <span key={val} className={cn(parseInt(val) === value && "text-foreground font-medium")}>
              {val}: {label}
            </span>
          ))}
        </div>
      )}
      {/* Current selection label */}
      {value !== null && labels[value] && (
        <p className="text-xs text-foreground font-mono">
          Selected: {labels[value]}
        </p>
      )}
    </div>
  );
};

/**
 * Single-line text field
 */
const TextField = ({ field, value, onChange, disabled }) => {
  const config = field.config || {};
  const { max_length, placeholder } = config;

  return (
    <Input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      maxLength={max_length}
      placeholder={placeholder || 'Enter text...'}
      className="font-mono"
    />
  );
};

/**
 * Multi-line text field
 */
const TextAreaField = ({ field, value, onChange, disabled }) => {
  const config = field.config || {};
  const { max_length, placeholder, rows = 3 } = config;

  return (
    <Textarea
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      maxLength={max_length}
      placeholder={placeholder || 'Enter text...'}
      rows={rows}
      className="font-mono text-sm resize-none"
    />
  );
};

/**
 * Calculated field (read-only)
 */
const CalculatedField = ({ field, value }) => {
  const config = field.config || {};
  const { unit } = config;

  return (
    <div className={cn(
      "px-3 py-2 rounded-lg border border-border bg-muted/30",
      "font-mono text-lg font-medium"
    )}>
      {value !== null && value !== undefined ? (
        <span>
          {value}
          {unit && <span className="text-muted-foreground text-sm ml-1">{unit}</span>}
        </span>
      ) : (
        <span className="text-muted-foreground text-sm">--</span>
      )}
    </div>
  );
};

/**
 * Paired field (e.g., blood pressure)
 */
const PairedField = ({ field, value, onChange, disabled, isCritical }) => {
  const config = field.config || {};
  const { fields = [], separator = '/', unit } = config;
  const pairedValue = typeof value === 'object' && value !== null ? value : {};

  const handleSubfieldChange = (key, newValue) => {
    onChange({
      ...pairedValue,
      [key]: newValue === '' ? null : parseFloat(newValue),
    });
  };

  return (
    <div className="flex items-center gap-2">
      {fields.map((subfield, idx) => (
        <div key={subfield.key} className="flex items-center gap-2">
          {idx > 0 && (
            <span className="text-muted-foreground font-mono">{separator}</span>
          )}
          <div className="flex-1">
            <Input
              type="number"
              value={pairedValue[subfield.key] ?? ''}
              onChange={(e) => handleSubfieldChange(subfield.key, e.target.value)}
              disabled={disabled}
              placeholder={subfield.label}
              className={cn(
                "font-mono w-20",
                isCritical && "border-rose-500"
              )}
            />
          </div>
        </div>
      ))}
      {unit && (
        <span className="text-muted-foreground font-mono text-sm">{unit}</span>
      )}
    </div>
  );
};

/**
 * Time field
 */
const TimeField = ({ field, value, onChange, disabled }) => {
  return (
    <Input
      type="time"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      className="font-mono"
    />
  );
};

/**
 * Boolean (yes/no) field
 */
const BooleanField = ({ field, value, onChange, disabled }) => {
  return (
    <div className="flex items-center gap-3">
      <Switch
        checked={value === true}
        onCheckedChange={(checked) => onChange(checked)}
        disabled={disabled}
      />
      <span className="font-mono text-sm text-muted-foreground">
        {value === true ? 'Yes' : value === false ? 'No' : 'Not set'}
      </span>
    </div>
  );
};

export { ChartFieldRenderer };
export default ChartFieldRenderer;
