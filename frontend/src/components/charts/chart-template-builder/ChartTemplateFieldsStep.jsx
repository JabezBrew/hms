import ListOrdered from 'lucide-react/dist/esm/icons/list-ordered.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import {
  DndContext,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import { Button } from '@/components/ui/button';

import { SortableFieldItem } from './SortableFieldItem';

export function ChartTemplateFieldsStep({
  fields,
  sensors,
  onAddField,
  onDragEnd,
  onEditField,
  onDeleteField,
}) {
  return (
    <div className="space-y-6 animate-chronicle-enter">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg text-foreground mb-1">
            Chart Fields
          </h2>
          <p className="font-mono text-xs text-muted-foreground">
            Add and configure fields for data entry
          </p>
        </div>
        <Button
          onClick={onAddField}
          size="sm"
          className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
        >
          <Plus className="size-3.5 mr-1.5" />
          Add Field
        </Button>
      </div>

      {fields.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <ListOrdered className="size-12 mx-auto mb-3 text-muted-foreground opacity-50" />
          <p className="font-mono text-sm text-muted-foreground">
            No fields yet
          </p>
          <p className="font-mono text-[10px] text-muted-foreground mt-1">
            Click "Add Field" to start building your chart
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={fields.map((field) => field.id || field.temp_id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {fields.map((field) => (
                <SortableFieldItem
                  key={field.id || field.temp_id}
                  field={field}
                  onEdit={onEditField}
                  onDelete={onDeleteField}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
