import BreakGlassDialog from '@/components/chronicle/BreakGlassDialog';
import { Button } from '@/components/ui/button';

export function ChronicleAccessDeniedState({
  breakGlassExpiresAt,
  breakGlassReason,
  canRequestBreakGlass,
  isBreakGlassOpen,
  isSubmitting,
  pageMeta,
  patient,
  patientName,
  rustV2Mode,
  onBreakGlassOpenChange,
  onBreakGlassReasonChange,
  onBreakGlassSubmit,
  breakGlassCategory,
  breakGlassConfirmed,
  breakGlassError,
  reauthRequired,
  isEndingBreakGlass,
  isCheckingBreakGlass,
  onBreakGlassCategoryChange,
  onBreakGlassConfirmedChange,
  onEndBreakGlass,
  onCheckRecordAccess,
  onSignInAgain,
}) {
  const patientDetails = patient?.local_data || patient;
  const patientMrn = patientDetails?.medical_record_number || patientDetails?.mrn;

  return (
    <>
      {pageMeta}
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
          <div className="rounded-2xl border border-border/70 bg-card/70 p-8 shadow-sm chronicle-card-glow">
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-2">
                <span className="badge-chronicle-rose text-[10px] uppercase tracking-[0.2em]">
                  Access Restricted
                </span>
                {breakGlassExpiresAt && (
                  <span className="badge-chronicle-amber text-[10px]">
                    Break-glass active
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <h2 className="font-display text-2xl text-foreground">
                  Team-based access required
                </h2>
                <p className="text-sm text-muted-foreground">
                  This patient record is protected by team-based access controls.
                  Request break-glass only for urgent clinical need. All access is audited.
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Patient
                </p>
                <p className="text-sm text-foreground">
                  {patientName || 'Unknown Patient'}
                </p>
                {patientMrn && (
                  <p className="text-xs text-muted-foreground">MRN {patientMrn}</p>
                )}
              </div>

              {canRequestBreakGlass ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => onBreakGlassOpenChange(true)}
                    disabled={isSubmitting || isEndingBreakGlass || isCheckingBreakGlass}
                  >
                    Request Break-Glass Access
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Provide a reason to unlock this record for a limited time.
                  </span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {rustV2Mode ? 'Emergency access requires dedicated permission. Contact an authorized clinical supervisor.' : 'Break-glass access is available to clinical staff only.'}
                </p>
              )}
              {rustV2Mode && canRequestBreakGlass && <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={onCheckRecordAccess} disabled={isCheckingBreakGlass || isSubmitting || isEndingBreakGlass}>Check record access</Button>
                <Button variant="outline" onClick={onEndBreakGlass} disabled={isCheckingBreakGlass || isSubmitting || isEndingBreakGlass}>{isEndingBreakGlass ? 'Ending access…' : 'End emergency access'}</Button>
              </div>}
              {isCheckingBreakGlass && <p role="status">Checking record access…</p>}
              {breakGlassError && !isBreakGlassOpen && <p role="alert" className="text-sm text-destructive">{breakGlassError}</p>}
            </div>
          </div>
        </div>

        {canRequestBreakGlass && (
          <BreakGlassDialog
            open={isBreakGlassOpen}
            onOpenChange={onBreakGlassOpenChange}
            patientName={patientName}
            patientMrn={patientMrn}
            reason={breakGlassReason}
            onReasonChange={onBreakGlassReasonChange}
            onSubmit={onBreakGlassSubmit}
            isSubmitting={isSubmitting}
            ttlMinutes={30}
            nativeMode={rustV2Mode}
            category={breakGlassCategory}
            onCategoryChange={onBreakGlassCategoryChange}
            confirmed={breakGlassConfirmed}
            onConfirmedChange={onBreakGlassConfirmedChange}
            error={breakGlassError}
            reauthRequired={reauthRequired}
            onSignInAgain={onSignInAgain}
          />
        )}
      </div>
    </>
  );
}
