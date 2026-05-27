import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { DISPLAY_MODES } from './chartTemplateBuilderOptions';

export function ChartTemplateSettingsStep({ formData, onUpdateField }) {
  return (
    <div className="space-y-6 animate-chronicle-enter">
      <div>
        <h2 className="font-display text-lg text-foreground mb-1">
          Display Settings
        </h2>
        <p className="font-mono text-xs text-muted-foreground">
          Configure how chart data is displayed
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Display Mode
          </Label>
          <div className="grid grid-cols-3 gap-3">
            {DISPLAY_MODES.map((mode) => (
              <button
                type="button"
                key={mode.value}
                onClick={() => onUpdateField('display_mode', mode.value)}
                className={cn(
                  'p-4 rounded-lg border text-center transition-all',
                  formData.display_mode === mode.value
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                    : 'border-border hover:border-primary/30'
                )}
              >
                <p className="font-mono text-sm font-medium">{mode.label}</p>
                <p className="font-mono text-[10px] text-muted-foreground mt-1">
                  {mode.description}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between p-4 rounded-lg border border-border">
          <div>
            <p className="font-mono text-sm font-medium">Active</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              Template can be assigned to patients
            </p>
          </div>
          <Switch
            checked={formData.is_active}
            onCheckedChange={(checked) => onUpdateField('is_active', checked)}
          />
        </div>
      </div>
    </div>
  );
}
