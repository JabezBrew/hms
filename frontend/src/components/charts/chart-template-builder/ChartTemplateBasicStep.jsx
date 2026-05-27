import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.js';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  CATEGORY_ICONS,
  SCOPE_OPTIONS,
  VISIBILITY_OPTIONS,
} from './chartTemplateBuilderOptions';

export function ChartTemplateBasicStep({ formData, categories, intervals, onUpdateField }) {
  return (
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
        <div className="space-y-2">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Chart Name *
          </Label>
          <Input
            value={formData.name}
            onChange={(event) => onUpdateField('name', event.target.value)}
            placeholder="e.g., Glasgow Coma Scale"
            className="font-mono"
          />
        </div>

        <div className="space-y-2">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Description
          </Label>
          <Textarea
            value={formData.description}
            onChange={(event) => onUpdateField('description', event.target.value)}
            placeholder="Brief description of what this chart monitors…"
            className="font-mono text-sm resize-none"
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Category
          </Label>
          <Select
            value={formData.category}
            onValueChange={(value) => onUpdateField('category', value)}
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
                      <Icon className="size-4" />
                      {cat.label}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <OptionGrid
          label="Visibility"
          options={VISIBILITY_OPTIONS}
          value={formData.visibility}
          onChange={(value) => onUpdateField('visibility', value)}
          columnsClassName="grid-cols-2"
        />

        <OptionGrid
          label="Scope"
          options={SCOPE_OPTIONS}
          value={formData.scope_type}
          onChange={(value) => onUpdateField('scope_type', value)}
          columnsClassName="grid-cols-1 sm:grid-cols-3"
        />

        <div className="space-y-2">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Default Monitoring Interval
          </Label>
          <Select
            value={formData.default_interval}
            onValueChange={(value) => onUpdateField('default_interval', value)}
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
  );
}

function OptionGrid({ label, options, value, onChange, columnsClassName }) {
  return (
    <div className="space-y-2">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <div className={cn('grid gap-2', columnsClassName)}>
        {options.map((opt) => (
          <button
            type="button"
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              'p-3 rounded-lg border text-left transition-all',
              value === opt.value
                ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                : 'border-border hover:border-primary/30'
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
  );
}
