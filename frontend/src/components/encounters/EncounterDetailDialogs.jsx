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

export function EncounterDetailDialogs({
  actionInProgress,
  onCancelEncounter,
  onDischargePatient,
  setShowCancelDialog,
  setShowDischargeDialog,
  showCancelDialog,
  showDischargeDialog,
}) {
  return (
    <>
      <AlertDialog open={showDischargeDialog} onOpenChange={setShowDischargeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discharge Patient</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to discharge this patient? This will mark the encounter as finished.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionInProgress}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDischargePatient}
              disabled={actionInProgress}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {actionInProgress ? 'Processing...' : 'Discharge Patient'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Encounter</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this encounter? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionInProgress}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onCancelEncounter}
              disabled={actionInProgress}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionInProgress ? 'Processing...' : 'Cancel Encounter'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
