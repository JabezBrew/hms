import { usePWA } from '@/hooks/usePWA';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Download,
  RefreshCw,
  Wifi,
  WifiOff,
  X,
  CheckCircle2
} from 'lucide-react';

/**
 * PWAPrompt - Displays PWA-related prompts
 *
 * Shows:
 * - Install prompt when app can be installed
 * - Update available notification
 * - Offline ready notification
 * - Offline status indicator
 */
export function PWAPrompt() {
  const {
    isOnline,
    canInstall,
    promptInstall,
    needRefresh,
    offlineReady,
    updateServiceWorker,
    dismissUpdate,
    dismissOfflineReady,
  } = usePWA();

  return (
    <>
      {/* Offline Status Banner */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[200] bg-amber-600 text-white px-4 py-2">
          <div className="flex items-center justify-center gap-2 text-sm font-medium">
            <WifiOff className="h-4 w-4" />
            <span>You're offline. Some features may be limited.</span>
          </div>
        </div>
      )}

      {/* Update Available Toast */}
      {needRefresh && (
        <PromptToast
          icon={<RefreshCw className="h-5 w-5" />}
          title="Update Available"
          description="A new version is ready. Refresh to update."
          primaryAction={{
            label: 'Refresh',
            onClick: () => updateServiceWorker(true),
          }}
          secondaryAction={{
            label: 'Later',
            onClick: dismissUpdate,
          }}
          variant="info"
        />
      )}

      {/* Offline Ready Toast */}
      {offlineReady && (
        <PromptToast
          icon={<CheckCircle2 className="h-5 w-5" />}
          title="Ready to Work Offline"
          description="The app has been cached for offline use."
          primaryAction={{
            label: 'Got it',
            onClick: dismissOfflineReady,
          }}
          variant="success"
          autoClose={5000}
          onAutoClose={dismissOfflineReady}
        />
      )}

      {/* Install Prompt Toast */}
      {canInstall && (
        <InstallPrompt onInstall={promptInstall} />
      )}
    </>
  );
}

/**
 * PromptToast - Reusable toast component for PWA prompts
 */
function PromptToast({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  variant = 'default',
  autoClose,
  onAutoClose,
}) {
  // Auto-close timer
  if (autoClose && onAutoClose) {
    setTimeout(onAutoClose, autoClose);
  }

  const variantStyles = {
    default: 'border-border bg-card',
    info: 'border-sky-500/30 bg-sky-950/90',
    success: 'border-emerald-500/30 bg-emerald-950/90',
  };

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-[200]',
        'w-full max-w-sm p-4 rounded-xl border shadow-lg',
        'animate-in slide-in-from-bottom-5 duration-300',
        variantStyles[variant]
      )}
    >
      <div className="flex gap-3">
        <div className="flex-shrink-0 text-primary">{icon}</div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-sm text-foreground">{title}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </Button>
            {secondaryAction && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={secondaryAction.onClick}
              >
                {secondaryAction.label}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * InstallPrompt - Collapsible install prompt
 */
function InstallPrompt({ onInstall }) {
  return (
    <div
      className={cn(
        'fixed bottom-4 left-4 z-[200]',
        'bg-card border border-border rounded-xl shadow-lg',
        'animate-in slide-in-from-bottom-5 duration-300',
        'overflow-hidden'
      )}
    >
      <button
        onClick={onInstall}
        className={cn(
          'flex items-center gap-3 p-3 pr-4',
          'hover:bg-muted/50 transition-colors',
          'text-left w-full'
        )}
      >
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Download className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h4 className="font-semibold text-sm text-foreground">Install HMS</h4>
          <p className="text-xs text-muted-foreground">
            Add to home screen for quick access
          </p>
        </div>
      </button>
    </div>
  );
}

/**
 * OfflineIndicator - Small indicator for header/status bar
 */
export function OfflineIndicator() {
  const { isOnline } = usePWA();

  if (isOnline) return null;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/10 text-amber-600 text-xs font-medium">
      <WifiOff className="h-3 w-3" />
      <span>Offline</span>
    </div>
  );
}

export default PWAPrompt;
