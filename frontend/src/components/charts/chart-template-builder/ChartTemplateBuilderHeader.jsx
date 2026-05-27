import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import X from 'lucide-react/dist/esm/icons/x.js';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/shared/components/page/PageHeader';

export function ChartTemplateBuilderHeader({ templateId, name, onClose }) {
  return (
    <header className="border-b border-border bg-card">
      <div className="px-6 py-4">
        <PageHeader
          wrap={false}
          title={(
            <span className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <ClipboardList className="size-5 text-amber-600 dark:text-amber-400" />
              </span>
              {templateId ? 'Edit Chart Template' : 'New Chart Template'}
            </span>
          )}
          description={name || null}
          descriptionClassName="font-mono text-xs text-muted-foreground mt-0.5"
          titleClassName="text-xl"
          actions={(
            <Button
              variant="destructive"
              size="sm"
              onClick={onClose}
              className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
            >
              <X className="size-4 mr-1.5" />
              Close
            </Button>
          )}
        />
      </div>
    </header>
  );
}
