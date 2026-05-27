import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js';
import CalendarX from 'lucide-react/dist/esm/icons/calendar-x.js';

import PersonalCalendarForm from '@/features/appointments/components/PersonalCalendarForm';
import BlockedTimeForm from '@/features/appointments/components/BlockedTimeForm';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

const getPractitionerName = (item) => item.practitioner_name || 'Unknown';

export function AvailabilityDialogs({
  isDoctor,
  createAvailabilityOpen,
  onCreateAvailabilityOpenChange,
  editAvailabilityOpen,
  onEditAvailabilityOpenChange,
  deleteAvailabilityOpen,
  onDeleteAvailabilityOpenChange,
  selectedAvailabilityRule,
  availabilityToDelete,
  onCreateAvailabilitySuccess,
  onUpdateAvailabilitySuccess,
  onDeleteAvailability,
  createBlockedTimeOpen,
  onCreateBlockedTimeOpenChange,
  editBlockedTimeOpen,
  onEditBlockedTimeOpenChange,
  deleteBlockedTimeOpen,
  onDeleteBlockedTimeOpenChange,
  selectedBlockedTime,
  blockedTimeToDelete,
  onCreateBlockedTimeSuccess,
  onUpdateBlockedTimeSuccess,
  onDeleteBlockedTime,
}) {
  return (
    <>
      <Dialog open={createAvailabilityOpen} onOpenChange={onCreateAvailabilityOpenChange}>
        <DialogContent className="sm:max-w-[550px] p-0 gap-0 z-[300]">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <CalendarClock className="size-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg">Create Personal Calendar Rule</DialogTitle>
                <DialogDescription className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {isDoctor ? 'Your availability' : 'Practitioner availability'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="px-6 py-5">
              <PersonalCalendarForm onSuccess={onCreateAvailabilitySuccess} />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={editAvailabilityOpen} onOpenChange={onEditAvailabilityOpenChange}>
        <DialogContent className="sm:max-w-[550px] p-0 gap-0 z-[300]">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <CalendarClock className="size-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg">Edit Personal Calendar Rule</DialogTitle>
                <DialogDescription className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Update calendar details
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="px-6 py-5">
              {selectedAvailabilityRule && (
                <PersonalCalendarForm
                  initialData={selectedAvailabilityRule}
                  onSuccess={onUpdateAvailabilitySuccess}
                />
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={createBlockedTimeOpen} onOpenChange={onCreateBlockedTimeOpenChange}>
        <DialogContent className="sm:max-w-[550px] p-0 gap-0 z-[300]">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30">
                <CalendarX className="size-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg">Block Time</DialogTitle>
                <DialogDescription className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Mark as unavailable
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="px-6 py-5">
              <BlockedTimeForm
                onSuccess={onCreateBlockedTimeSuccess}
                onCancel={() => onCreateBlockedTimeOpenChange(false)}
              />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={editBlockedTimeOpen} onOpenChange={onEditBlockedTimeOpenChange}>
        <DialogContent className="sm:max-w-[550px] p-0 gap-0 z-[300]">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30">
                <CalendarX className="size-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg">Edit Blocked Time</DialogTitle>
                <DialogDescription className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Update blocked time
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="px-6 py-5">
              {selectedBlockedTime && (
                <BlockedTimeForm
                  initialData={selectedBlockedTime}
                  onSuccess={onUpdateBlockedTimeSuccess}
                  onCancel={() => onEditBlockedTimeOpenChange(false)}
                />
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteAvailabilityOpen} onOpenChange={onDeleteAvailabilityOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Personal Calendar Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this personal calendar rule. This action cannot be undone.
            </AlertDialogDescription>
            {availabilityToDelete && (
              <div className="mt-2 p-3 bg-muted/50 rounded-lg">
                <p className="font-medium">{availabilityToDelete.name}</p>
                <p className="text-sm text-muted-foreground">
                  {getPractitionerName(availabilityToDelete)}
                </p>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDeleteAvailability(availabilityToDelete?.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteBlockedTimeOpen} onOpenChange={onDeleteBlockedTimeOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Blocked Time?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the blocked time and make it available for bookings again.
            </AlertDialogDescription>
            {blockedTimeToDelete && (
              <div className="mt-2 p-3 bg-muted/50 rounded-lg">
                <p className="font-medium">{blockedTimeToDelete.reason || 'Blocked Time'}</p>
                <p className="text-sm text-muted-foreground">
                  {new Date(blockedTimeToDelete.date || blockedTimeToDelete.start_date).toLocaleDateString()}
                </p>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDeleteBlockedTime(blockedTimeToDelete?.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
