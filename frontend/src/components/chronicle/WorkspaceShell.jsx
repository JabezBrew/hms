import { cn } from '@/lib/utils';
import { useWorkspaceDisplay } from '@/contexts/WorkspaceDisplayContext';

/**
 * WorkspaceShell — shared positioning wrapper for all Chronicle workspace panels.
 *
 * In 'inline' mode (desktop): renders as a flex column filling its parent ResizablePanel.
 *   Width overrides are ignored — the panel controls width.
 *
 * In 'overlay' mode (mobile): renders as a fixed right-side panel with slide animation.
 *   overlayClassName is applied for per-workspace width overrides (e.g. lg:w-[34rem]).
 *
 * @param {boolean} open - Whether the workspace is open (overlay mode only)
 * @param {string} [overlayClassName] - Additional classes for overlay mode only (width overrides)
 * @param {React.ReactNode} children - Header + content
 */
export function WorkspaceShell({ open, overlayClassName, children }) {
  const { variant } = useWorkspaceDisplay();

  if (variant === 'inline') {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        {children}
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        'fixed inset-y-0 right-0 z-[100] w-full bg-background border-l border-border',
        'transform transition-transform duration-300 ease-in-out',
        'flex flex-col shadow-2xl',
        'lg:w-1/2',
        open ? 'translate-x-0' : 'translate-x-full',
        overlayClassName,
      )}
    >
      {children}
    </div>
  );
}
