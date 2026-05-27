import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';

import { ChartFieldRenderer } from '../ChartFieldRenderer';

export function ChartTemplatePreviewStep({ formData, fields, previewData }) {
  return (
    <div className="space-y-6 animate-chronicle-enter">
      <div>
        <h2 className="font-display text-lg text-foreground mb-1">
          Preview
        </h2>
        <p className="font-mono text-xs text-muted-foreground">
          See how the chart entry form will look
        </p>
      </div>

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-muted/30 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <ClipboardList className="size-4 text-amber-600" />
            </div>
            <div>
              <h3 className="font-display text-base">
                {formData.name || 'Chart Template'}
              </h3>
              <p className="font-mono text-[10px] text-muted-foreground">
                {fields.length} field{fields.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {fields.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground font-mono text-sm">
              Add fields to see preview
            </p>
          ) : (
            fields.map((field) => (
              <ChartFieldRenderer
                key={field.id || field.temp_id}
                field={field}
                value={previewData[field.field_key]}
                onChange={() => {}}
                disabled
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
