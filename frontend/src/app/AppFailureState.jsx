import { useState } from 'react'
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js'
import Clipboard from 'lucide-react/dist/esm/icons/clipboard.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBuildLabel } from '@/lib/build-info'
import { formatRuntimeDiagnostics } from '@/lib/runtime-diagnostics'

export default function AppFailureState({
  description,
  diagnostics,
  error,
  onPrimaryAction,
  primaryActionLabel = 'Reload HMS',
  title,
}) {
  const [copyStatus, setCopyStatus] = useState('idle')
  const buildLabel = diagnostics?.build ? formatBuildLabel(diagnostics.build) : null

  const handleCopyDiagnostics = async () => {
    if (!globalThis?.navigator?.clipboard?.writeText) {
      setCopyStatus('unsupported')
      return
    }

    try {
      await globalThis.navigator.clipboard.writeText(formatRuntimeDiagnostics(diagnostics))
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-2xl border-border/80 shadow-lg">
        <CardHeader className="space-y-4">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="size-6 text-destructive" />
          </div>
          <div className="space-y-2 text-center">
            <CardTitle>{title}</CardTitle>
            <CardDescription className="text-sm leading-6">{description}</CardDescription>
          </div>
          {buildLabel && (
            <div className="text-center text-xs font-mono text-muted-foreground">
              Build {buildLabel}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {error?.message && (
            <div className="rounded-md border bg-muted/50 p-3">
              <p className="break-all text-sm font-mono text-muted-foreground">{error.message}</p>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={onPrimaryAction} className="flex-1">
              <RefreshCw className="mr-2 size-4" />
              {primaryActionLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => globalThis?.window?.location?.assign('/')}
            >
              Go Home
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={handleCopyDiagnostics}>
              <Clipboard className="mr-2 size-4" />
              {copyStatus === 'copied'
                ? 'Copied'
                : copyStatus === 'unsupported'
                  ? 'Clipboard Unavailable'
                  : copyStatus === 'failed'
                    ? 'Copy Failed'
                    : 'Copy Diagnostics'}
            </Button>
          </div>

          {diagnostics && (
            <details className="rounded-md border bg-muted/30 p-3">
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                Runtime diagnostics
              </summary>
              <pre className="mt-3 max-h-80 overflow-auto rounded bg-background p-3 text-xs">
                {formatRuntimeDiagnostics(diagnostics)}
              </pre>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
