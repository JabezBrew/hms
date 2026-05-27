import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import KeyRound from 'lucide-react/dist/esm/icons/key-round.js';
import Mail from 'lucide-react/dist/esm/icons/mail.js';
import UserCheck from 'lucide-react/dist/esm/icons/user-check.js';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export function StaffQuickActions({
  view,
  isResettingPassword,
  isResendingSetupLink,
  isReactivating,
  onEdit,
  onManageSchedule,
  onReactivate,
  onResetPassword,
  onResendSetupLink,
}) {
  return (
    <section className="pt-4 border-t border-border">
      <div className="flex flex-wrap gap-2">
        {!view.isActive ? (
          <Button
            size="sm"
            onClick={onReactivate}
            disabled={isReactivating}
            className="font-mono text-xs"
          >
            <UserCheck className="size-4 mr-2" />
            {isReactivating ? 'Reactivating' : 'Reactivate'}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Edit className="size-4 mr-2" />
          Edit Profile
        </Button>
        {view.userType === 'doctor' ? (
          <Button variant="outline" size="sm" onClick={onManageSchedule}>
            <Calendar className="size-4 mr-2" />
            Schedule
          </Button>
        ) : null}
        {view.isActive ? (
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <KeyRound className="size-4 mr-2" />
                  Reset Password
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset Password for {view.fullName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will send a password reset link to {view.email || 'the user\'s email'}.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onResetPassword} disabled={isResettingPassword}>
                    {isResettingPassword ? 'Sending' : 'Send Reset Email'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Mail className="size-4 mr-2" />
                  Resend Setup Link
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Resend setup link to {view.fullName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A fresh account setup/reset link will be emailed to {view.email || 'the user\'s email'}.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onResendSetupLink} disabled={isResendingSetupLink}>
                    {isResendingSetupLink ? 'Sending' : 'Resend Link'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </div>
    </section>
  );
}
