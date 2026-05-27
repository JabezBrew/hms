import GripVertical from 'lucide-react/dist/esm/icons/grip-vertical.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SortableFieldItem({ field, onEdit, onDelete }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id || field.temp_id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border border-border bg-card',
        'transition-all hover:border-primary/30',
        isDragging && 'opacity-50 shadow-lg'
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="size-4" />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium truncate">
            {field.name}
          </span>
          {field.is_required ? (
            <span className="text-[9px] font-mono uppercase text-rose-500">
              Required
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-mono text-[10px] text-muted-foreground">
            {field.field_type}
          </span>
          {field.group_name ? (
            <>
              <span className="text-muted-foreground">•</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {field.group_name}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(field)}
          className="size-7 p-0"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(field)}
          className="size-7 p-0 text-rose-500 hover:text-rose-600"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
