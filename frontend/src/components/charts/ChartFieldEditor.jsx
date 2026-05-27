/**
 * ChartFieldEditor - Modal for configuring chart fields
 *
 * Full-featured editor for defining field type, validation,
 * and display settings. Chronicle Design System styling.
 */

import Hash from 'lucide-react/dist/esm/icons/hash.js';
import List from 'lucide-react/dist/esm/icons/list.js';
import Type from 'lucide-react/dist/esm/icons/type.js';
import AlignLeft from 'lucide-react/dist/esm/icons/align-left.js';
import Calculator from 'lucide-react/dist/esm/icons/calculator.js';
import Columns2 from 'lucide-react/dist/esm/icons/columns-2.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import ToggleLeft from 'lucide-react/dist/esm/icons/toggle-left.js';
import Gauge from 'lucide-react/dist/esm/icons/gauge.js';
import MapPinned from 'lucide-react/dist/esm/icons/map-pinned.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

const DEFAULT_EMPTY_ARRAY = [];
let nextChartEditorRowKey = 0;

const createChartEditorRowKey = (prefix) => {
  nextChartEditorRowKey += 1;
  return `${prefix}-${nextChartEditorRowKey}`;
};

// Field type options with icons
const FIELD_TYPES = [
  { value: 'numeric', label: 'Numeric', icon: Hash, description: 'Numbers with units and ranges' },
  { value: 'select', label: 'Select', icon: List, description: 'Single choice from options' },
  { value: 'multi_select', label: 'Multi-Select', icon: List, description: 'Multiple choices' },
  { value: 'scale', label: 'Scale', icon: Gauge, description: 'Numeric scale (e.g., 1-10)' },
  { value: 'text', label: 'Text', icon: Type, description: 'Single line text' },
  { value: 'textarea', label: 'Text Area', icon: AlignLeft, description: 'Multi-line text' },
  { value: 'calculated', label: 'Calculated', icon: Calculator, description: 'Auto-computed from formula' },
  { value: 'paired', label: 'Paired', icon: Columns2, description: 'Two linked values (e.g., BP)' },
  { value: 'time', label: 'Time', icon: Clock, description: 'Time picker' },
  { value: 'boolean', label: 'Yes/No', icon: ToggleLeft, description: 'Toggle switch' },
  { value: 'body_map', label: 'Body Map', icon: MapPinned, description: 'Structured body location selector' },
];

const ChartFieldEditor = ({
  open,
  onOpenChange,
  field,
  existingFieldKeys = DEFAULT_EMPTY_ARRAY,
  onSave,
  isSaving = false,
}) => {
  const isEditing = !!field?.id;

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    field_key: '',
    field_type: 'numeric',
    is_required: false,
    group_name: '',
    help_text: '',
    config: {},
  });

  // Initialize form when field changes
  useEffect(() => {
    if (field) {
      setFormData({
        name: field.name || '',
        field_key: field.field_key || '',
        field_type: field.field_type || 'numeric',
        is_required: field.is_required || false,
        group_name: field.group_name || '',
        help_text: field.help_text || '',
        config: field.config || {},
      });
    } else {
      setFormData({
        name: '',
        field_key: '',
        field_type: 'numeric',
        is_required: false,
        group_name: '',
        help_text: '',
        config: {},
      });
    }
  }, [field, open]);

  // Auto-generate field_key from name
  const handleNameChange = (name) => {
    setFormData((prev) => ({
      ...prev,
      name,
      field_key: isEditing ? prev.field_key : name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
    }));
  };

  // Update config
  const updateConfig = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      config: { ...prev.config, [key]: value },
    }));
  };

  // Validate form
  const validateForm = () => {
    if (!formData.name.trim()) return 'Name is required';
    if (!formData.field_key.trim()) return 'Field key is required';
    if (!/^[a-z][a-z0-9_]*$/.test(formData.field_key)) {
      return 'Field key must be lowercase with underscores';
    }
    if (!isEditing && existingFieldKeys.includes(formData.field_key)) {
      return 'Field key already exists';
    }
    return null;
  };

  const handleSave = () => {
    const error = validateForm();
    if (error) {
      return; // Could show error toast
    }
    onSave(formData);
  };

  const error = validateForm();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col z-[150]">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {isEditing ? 'Edit Field' : 'Add Field'}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Configure the field type, validation rules, and display settings.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="basic" className="flex-1 font-mono text-xs">
                Basic
              </TabsTrigger>
              <TabsTrigger value="config" className="flex-1 font-mono text-xs">
                Configuration
              </TabsTrigger>
              <TabsTrigger value="validation" className="flex-1 font-mono text-xs">
                Validation
              </TabsTrigger>
            </TabsList>

            {/* Basic Settings */}
            <TabsContent value="basic" className="space-y-4 mt-4">
              {/* Name */}
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Field Name *
                </Label>
                <Input
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g., Temperature"
                  className="font-mono"
                />
              </div>

              {/* Field Key */}
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Field Key *
                </Label>
                <Input
                  value={formData.field_key}
                  onChange={(e) => setFormData((prev) => ({ ...prev, field_key: e.target.value }))}
                  placeholder="e.g., temperature"
                  className="font-mono"
                  disabled={isEditing}
                />
                <p className="text-[10px] text-muted-foreground">
                  Internal identifier (snake_case). Cannot be changed after creation.
                </p>
              </div>

              {/* Field Type */}
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Field Type *
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {FIELD_TYPES.map((type) => {
                    const Icon = type.icon;
                    return (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setFormData((prev) => ({
                          ...prev,
                          field_type: type.value,
                          config: {}, // Reset config when type changes
                        }))}
                        className={cn(
                          "flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-all",
                          formData.field_type === type.value
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        )}
                      >
                        <Icon className={cn(
                          "size-4",
                          formData.field_type === type.value ? "text-primary" : "text-muted-foreground"
                        )} />
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-medium">{type.label}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{type.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Group Name */}
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Group Name
                </Label>
                <Input
                  value={formData.group_name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, group_name: e.target.value }))}
                  placeholder="e.g., Vital Signs"
                  className="font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Optional. Group related fields together in the form.
                </p>
              </div>

              {/* Help Text */}
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Help Text
                </Label>
                <Textarea
                  value={formData.help_text}
                  onChange={(e) => setFormData((prev) => ({ ...prev, help_text: e.target.value }))}
                  placeholder="Instructions for recording this field..."
                  className="font-mono text-sm resize-none"
                  rows={2}
                />
              </div>

              {/* Required */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <Label className="font-mono text-sm">Required Field</Label>
                  <p className="text-[10px] text-muted-foreground">
                    Entry cannot be saved without this field
                  </p>
                </div>
                <Switch
                  checked={formData.is_required}
                  onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, is_required: checked }))}
                />
              </div>
            </TabsContent>

            {/* Type-specific Configuration */}
            <TabsContent value="config" className="space-y-4 mt-4">
              {formData.field_type === 'numeric' && (
                <NumericConfig config={formData.config} updateConfig={updateConfig} />
              )}
              {formData.field_type === 'select' && (
                <SelectConfig config={formData.config} updateConfig={updateConfig} />
              )}
              {formData.field_type === 'multi_select' && (
                <SelectConfig config={formData.config} updateConfig={updateConfig} multiple />
              )}
              {formData.field_type === 'scale' && (
                <ScaleConfig config={formData.config} updateConfig={updateConfig} />
              )}
              {formData.field_type === 'text' && (
                <TextConfig config={formData.config} updateConfig={updateConfig} />
              )}
              {formData.field_type === 'textarea' && (
                <TextAreaConfig config={formData.config} updateConfig={updateConfig} />
              )}
              {formData.field_type === 'calculated' && (
                <CalculatedConfig config={formData.config} updateConfig={updateConfig} existingFieldKeys={existingFieldKeys} />
              )}
              {formData.field_type === 'paired' && (
                <PairedConfig config={formData.config} updateConfig={updateConfig} />
              )}
              {formData.field_type === 'boolean' && (
                <p className="text-sm text-muted-foreground">
                  No additional configuration needed for Yes/No fields.
                </p>
              )}
              {formData.field_type === 'body_map' && (
                <BodyMapConfig config={formData.config} updateConfig={updateConfig} />
              )}
              {formData.field_type === 'time' && (
                <p className="text-sm text-muted-foreground">
                  No additional configuration needed for Time fields.
                </p>
              )}
            </TabsContent>

            {/* Validation */}
            <TabsContent value="validation" className="space-y-4 mt-4">
              {(formData.field_type === 'numeric' || formData.field_type === 'scale') && (
                <CriticalRangeConfig config={formData.config} updateConfig={updateConfig} />
              )}
              {formData.field_type !== 'numeric' && formData.field_type !== 'scale' && (
                <p className="text-sm text-muted-foreground">
                  Critical value detection is only available for numeric and scale fields.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </ScrollArea>

        <DialogFooter className="pt-4 border-t">
          {error && (
            <p className="flex items-center gap-1 text-xs text-rose-500 mr-auto">
              <AlertTriangle className="size-3" />
              {error}
            </p>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} className="font-mono text-xs">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!!error || isSaving}
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
                {isEditing ? 'Update Field' : 'Add Field'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// =============================================================================
// Type-specific Configuration Components
// =============================================================================

const NumericConfig = ({ config, updateConfig }) => (
  <div className="space-y-4">
    <div className="space-y-2">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Unit
      </Label>
      <Input
        value={config.unit || ''}
        onChange={(e) => updateConfig('unit', e.target.value)}
        placeholder="e.g., °C, mmHg, ml"
        className="font-mono"
      />
    </div>
    <div className="grid grid-cols-3 gap-4">
      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Minimum
        </Label>
        <Input
          type="number"
          value={config.min ?? ''}
          onChange={(e) => updateConfig('min', e.target.value === '' ? undefined : parseFloat(e.target.value))}
          placeholder="Min"
          className="font-mono"
        />
      </div>
      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Maximum
        </Label>
        <Input
          type="number"
          value={config.max ?? ''}
          onChange={(e) => updateConfig('max', e.target.value === '' ? undefined : parseFloat(e.target.value))}
          placeholder="Max"
          className="font-mono"
        />
      </div>
      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Decimals
        </Label>
        <Input
          type="number"
          value={config.decimals ?? 0}
          onChange={(e) => updateConfig('decimals', parseInt(e.target.value) || 0)}
          min={0}
          max={4}
          className="font-mono"
        />
      </div>
    </div>
  </div>
);

const SelectConfig = ({ config, updateConfig }) => {
  const options = config.options ?? DEFAULT_EMPTY_ARRAY;
  const optionKeysRef = useRef([]);

  if (optionKeysRef.current.length > options.length) {
    optionKeysRef.current.length = options.length;
  }
  while (optionKeysRef.current.length < options.length) {
    optionKeysRef.current.push(createChartEditorRowKey('option'));
  }

  const optionRows = options.map((option, position) => ({
    option,
    position,
    rowKey: optionKeysRef.current[position] || option.value || option.label || `option-fallback-${position}`,
  }));

  const addOption = () => {
    optionKeysRef.current.push(createChartEditorRowKey('option'));
    updateConfig('options', [...options, { value: '', label: '' }]);
  };

  const updateOption = (index, key, value) => {
    const newOptions = [...options];
    newOptions[index] = { ...newOptions[index], [key]: value };

    // Auto-generate value from label
    if (key === 'label') {
      newOptions[index].value = value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    }

    updateConfig('options', newOptions);
  };

  const removeOption = (index) => {
    optionKeysRef.current.splice(index, 1);
    updateConfig('options', options.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Options
        </Label>
        <Button variant="outline" size="sm" onClick={addOption} className="font-mono text-xs">
          <Plus className="size-3 mr-1" />
          Add Option
        </Button>
      </div>
      <div className="space-y-2">
        {optionRows.map(({ option: opt, position, rowKey }) => (
          <div key={rowKey} className="flex items-center gap-2">
            <Input
              value={opt.label}
              onChange={(e) => updateOption(position, 'label', e.target.value)}
              placeholder="Label"
              className="font-mono flex-1"
            />
            <Input
              value={opt.value}
              onChange={(e) => updateOption(position, 'value', e.target.value)}
              placeholder="value"
              className="font-mono w-32"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeOption(position)}
              className="size-9 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {options.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No options added. Click "Add Option" to create choices.
          </p>
        )}
      </div>
    </div>
  );
};

const ScaleConfig = ({ config, updateConfig }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-3 gap-4">
      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Minimum
        </Label>
        <Input
          type="number"
          value={config.min ?? 1}
          onChange={(e) => updateConfig('min', parseInt(e.target.value) || 1)}
          className="font-mono"
        />
      </div>
      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Maximum
        </Label>
        <Input
          type="number"
          value={config.max ?? 10}
          onChange={(e) => updateConfig('max', parseInt(e.target.value) || 10)}
          className="font-mono"
        />
      </div>
      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Step
        </Label>
        <Input
          type="number"
          value={config.step ?? 1}
          onChange={(e) => updateConfig('step', parseInt(e.target.value) || 1)}
          min={1}
          className="font-mono"
        />
      </div>
    </div>
    <p className="text-[10px] text-muted-foreground">
      You can add labels like "1: None, 10: Severe" in the Help Text field.
    </p>
  </div>
);

const TextConfig = ({ config, updateConfig }) => (
  <div className="space-y-4">
    <div className="space-y-2">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Maximum Length
      </Label>
      <Input
        type="number"
        value={config.max_length ?? ''}
        onChange={(e) => updateConfig('max_length', e.target.value === '' ? undefined : parseInt(e.target.value))}
        placeholder="No limit"
        className="font-mono"
      />
    </div>
    <div className="space-y-2">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Placeholder
      </Label>
      <Input
        value={config.placeholder || ''}
        onChange={(e) => updateConfig('placeholder', e.target.value)}
        placeholder="Enter placeholder text..."
        className="font-mono"
      />
    </div>
  </div>
);

const TextAreaConfig = ({ config, updateConfig }) => (
  <div className="space-y-4">
    <TextConfig config={config} updateConfig={updateConfig} />
    <div className="space-y-2">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Rows
      </Label>
      <Input
        type="number"
        value={config.rows ?? 3}
        onChange={(e) => updateConfig('rows', parseInt(e.target.value) || 3)}
        min={2}
        max={10}
        className="font-mono"
      />
    </div>
  </div>
);

const CalculatedConfig = ({ config, updateConfig, existingFieldKeys }) => (
  <div className="space-y-4">
    <div className="space-y-2">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Formula *
      </Label>
      <Textarea
        value={config.formula || ''}
        onChange={(e) => updateConfig('formula', e.target.value)}
        placeholder="{eye_opening} + {verbal_response} + {motor_response}"
        className="font-mono text-sm resize-none"
        rows={3}
      />
      <p className="text-[10px] text-muted-foreground">
        Use {'{field_key}'} to reference other fields. Supports +, -, *, / and parentheses.
        Functions: sum(), avg(), min(), max()
      </p>
    </div>
    {existingFieldKeys.length > 0 && (
      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Available Fields
        </Label>
        <div className="flex flex-wrap gap-1">
          {existingFieldKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => updateConfig('formula', (config.formula || '') + `{${key}}`)}
              className="px-2 py-1 rounded bg-muted text-muted-foreground font-mono text-[10px] hover:bg-muted/80"
            >
              {'{' + key + '}'}
            </button>
          ))}
        </div>
      </div>
    )}
    <div className="space-y-2">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Unit (optional)
      </Label>
      <Input
        value={config.unit || ''}
        onChange={(e) => updateConfig('unit', e.target.value)}
        placeholder="e.g., points"
        className="font-mono"
      />
    </div>
  </div>
);

const PairedConfig = ({ config, updateConfig }) => {
  const fields = config.fields || [
    { key: 'systolic', label: 'Systolic' },
    { key: 'diastolic', label: 'Diastolic' },
  ];

  const updateField = (index, key, value) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], [key]: value };
    if (key === 'label') {
      newFields[index].key = value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    }
    updateConfig('fields', newFields);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={field.key || field.label} className="flex items-center gap-2">
            <span className="text-muted-foreground font-mono text-sm w-16">
              Field {index + 1}
            </span>
            <Input
              value={field.label}
              onChange={(e) => updateField(index, 'label', e.target.value)}
              placeholder="Label"
              className="font-mono flex-1"
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Separator
          </Label>
          <Input
            value={config.separator || '/'}
            onChange={(e) => updateConfig('separator', e.target.value)}
            className="font-mono w-20"
          />
        </div>
        <div className="space-y-2">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Unit
          </Label>
          <Input
            value={config.unit || ''}
            onChange={(e) => updateConfig('unit', e.target.value)}
            placeholder="e.g., mmHg"
            className="font-mono"
          />
        </div>
      </div>
    </div>
  );
};

const BodyMapConfig = ({ config, updateConfig }) => (
  <div className="space-y-4">
    <div className="space-y-2">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Mode
      </Label>
      <Select
        value={config.mode || 'pain'}
        onValueChange={(value) => updateConfig('mode', value)}
      >
        <SelectTrigger className="font-mono">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          <SelectItem value="pain" className="font-mono">Pain Mapping</SelectItem>
          <SelectItem value="wound" className="font-mono">Wound Mapping</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <p className="text-sm text-muted-foreground">
      Body-map fields store a structured surface, side, region, and free-text marker label for review workflows.
    </p>
  </div>
);

const CriticalRangeConfig = ({ config, updateConfig }) => (
  <div className="space-y-4">
    <p className="text-sm text-muted-foreground">
      Set critical thresholds to trigger alerts when values are outside normal range.
    </p>
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Critical Low
        </Label>
        <Input
          type="number"
          value={config.critical_low ?? ''}
          onChange={(e) => updateConfig('critical_low', e.target.value === '' ? undefined : parseFloat(e.target.value))}
          placeholder="Below this is critical"
          className="font-mono"
        />
      </div>
      <div className="space-y-2">
        <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Critical High
        </Label>
        <Input
          type="number"
          value={config.critical_high ?? ''}
          onChange={(e) => updateConfig('critical_high', e.target.value === '' ? undefined : parseFloat(e.target.value))}
          placeholder="Above this is critical"
          className="font-mono"
        />
      </div>
    </div>
  </div>
);

export { ChartFieldEditor };
