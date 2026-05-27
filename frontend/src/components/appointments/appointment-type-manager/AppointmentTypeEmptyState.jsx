import { Button } from '@/components/ui/button';

export function AppointmentTypeEmptyState({ canMutate, onAddNew }) {
  return (
    <div className="text-center py-4 border rounded-md bg-muted/20">
      <p className="text-muted-foreground">No appointment types found.</p>
      {canMutate ? (
        <Button onClick={onAddNew} variant="outline" className="mt-2">
          Create your first appointment type
        </Button>
      ) : null}
    </div>
  );
}
