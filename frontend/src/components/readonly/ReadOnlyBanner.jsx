import Lock from 'lucide-react/dist/esm/icons/lock.js';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';

import { cn } from '@/lib/utils';

/**
 * Slim banner that displays when user is in read-only mode (off-site access).
 * Minimal design - just a thin strip at the top.
 */
export function ReadOnlyBanner({ className }) {
  const { isReadOnly } = useReadOnlyMode();

  if (!isReadOnly) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-[100] bg-amber-500 dark:bg-amber-600 text-white py-1 px-4',
        'flex items-center justify-center gap-2 text-xs font-medium shadow-sm',
        className
      )}
    >
      <Lock className="size-3" />
      <span>Read-Only Mode: Off-site access</span>
    </div>
  );
}
