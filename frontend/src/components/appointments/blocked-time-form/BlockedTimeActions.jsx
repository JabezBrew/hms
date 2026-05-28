import { LoadingSpinner } from '@/components/ui/loading-spinner';

import { Button } from '@/components/ui/button';

export function BlockedTimeActions({ initialData, isSubmitting, onCancel }) {
  return (
    <div className="flex justify-end gap-x-2">
      <Button variant="outline" type="button" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting && <LoadingSpinner className="mr-2 size-4" />}
        {initialData ? 'Update' : 'Create'}
      </Button>
    </div>
  );
}
