import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';

import { Button } from '@/components/ui/button';

export function BlockedTimeActions({ initialData, isSubmitting, onCancel }) {
  return (
    <div className="flex justify-end gap-x-2">
      <Button variant="outline" type="button" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
        {initialData ? 'Update' : 'Create'}
      </Button>
    </div>
  );
}
