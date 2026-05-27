import Clock from 'lucide-react/dist/esm/icons/clock.js';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useSessionTimeoutWarning } from './session-timeout/useSessionTimeoutWarning';

function getWarningMessage(timeoutType) {
  if (timeoutType === 'absolute') {
    return {
      title: 'Maximum Session Time Reached',
      description: 'For security reasons, you must re-authenticate after 8 hours. Your session will end in ',
      canExtend: false,
    };
  }
  return {
    title: 'Session Expiring Soon',
    description: 'Your session will expire due to inactivity in ',
    canExtend: true,
  };
}

/**
 * SessionTimeoutWarning component
 * Warns users before their session expires and offers to extend it
 * Prevents data loss and improves security UX
 */
export function SessionTimeoutWarning() {
  const {
    isAuthenticated,
    showWarning,
    timeLeft,
    timeoutType,
    handleExtendSession,
    handleTimeout,
    handleOpenChange,
  } = useSessionTimeoutWarning();

  if (!isAuthenticated) return null;

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const warningMessage = getWarningMessage(timeoutType);

  return (
    <AlertDialog
      open={showWarning}
      onOpenChange={handleOpenChange}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900">
            <Clock className="size-6 text-amber-600 dark:text-amber-400" />
          </div>
          <AlertDialogTitle className="text-center">
            {warningMessage.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {warningMessage.description}
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              {minutes}:{seconds.toString().padStart(2, '0')}
            </span>
            .
            {warningMessage.canExtend && (
              <>
                <br />
                Would you like to continue your session?
              </>
            )}
            {!warningMessage.canExtend && (
              <>
                <br />
                Please save your work and log in again to continue.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogCancel onClick={handleTimeout}>
            Logout Now
          </AlertDialogCancel>
          {warningMessage.canExtend && (
            <AlertDialogAction onClick={handleExtendSession}>
              Continue Session
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
