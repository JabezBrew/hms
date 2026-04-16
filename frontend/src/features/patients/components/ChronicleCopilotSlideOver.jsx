import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js'
import X from 'lucide-react/dist/esm/icons/x.js'

import { Button } from '@/components/ui/button'

import { WorkspaceShell } from '@/components/chronicle/WorkspaceShell'
import ChronicleCopilotPanel from '@/features/patients/components/ChronicleCopilotPanel'

export default function ChronicleCopilotSlideOver({
  open,
  onClose,
  patientId,
  encounterId = null,
  patientName = 'Patient',
}) {
  return (
    <WorkspaceShell open={open} overlayClassName="lg:w-[34rem]">
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2">
              <Sparkles className="h-5 w-5 text-amber-600" />
            </div>
            <div className="space-y-1">
              <h2 className="font-display text-xl text-foreground">Ask Chronicle</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Advisory AI support for {patientName}. Always validate with full chart review.
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onClose}
            aria-label="Close Ask Chronicle"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <ChronicleCopilotPanel
          patientId={patientId}
          encounterId={encounterId}
          patientName={patientName}
          variant="plain"
          showHeading={false}
        />
      </div>
    </WorkspaceShell>
  )
}
