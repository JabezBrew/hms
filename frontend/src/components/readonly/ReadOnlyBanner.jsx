import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js';
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

/**
 * Compact indicator for showing read-only status in smaller spaces.
 * Can be used in headers, sidebars, or near action buttons.
 */
export function ReadOnlyIndicator({ className, showLabel = true }) {
  const { isReadOnly } = useReadOnlyMode();

  if (!isReadOnly) {
    return null;
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md',
        'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400',
        'text-xs font-medium',
        className
      )}
      title="Read-only mode: Write operations are disabled"
    >
      <EyeOff className="size-3" />
      {showLabel && <span>Read-Only</span>}
    </div>
  );
}

/**
 * Wrapper component that adds visual indication when a section is disabled
 * due to read-only mode.
 */
export function ReadOnlyWrapper({ children, className, showOverlay = true }) {
  const { isReadOnly, readonlyMessage } = useReadOnlyMode();

  if (!isReadOnly) {
    return children;
  }

  return (
    <div className={cn('relative', className)}>
      {/* Original content with reduced opacity */}
      <div className="opacity-60 pointer-events-none select-none">
        {children}
      </div>

      {/* Overlay with message */}
      {showOverlay && (
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center',
            'bg-stone-100/50 dark:bg-stone-900/50 backdrop-blur-[1px]',
            'rounded-lg'
          )}
        >
          <div className="flex flex-col items-center gap-2 text-center p-4">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <Lock className="size-5" />
              <span className="font-medium">Read-Only Mode</span>
            </div>
            <p className="text-sm text-muted-foreground max-w-xs">
              {readonlyMessage || 'This section is disabled while accessing from off-site.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Button wrapper that disables the button and shows tooltip in read-only mode.
 */
export function ReadOnlyButton({ children, onClick, disabled, ...props }) {
  const { isReadOnly, readonlyMessage } = useReadOnlyMode();

  const isDisabled = disabled || isReadOnly;

  return (
    <button
      type="button"
      {...props}
      disabled={isDisabled}
      onClick={isDisabled ? undefined : onClick}
      title={isReadOnly ? (readonlyMessage || 'Disabled in read-only mode') : props.title}
      className={cn(
        props.className,
        isReadOnly && 'cursor-not-allowed'
      )}
    >
      {children}
    </button>
  );
}
