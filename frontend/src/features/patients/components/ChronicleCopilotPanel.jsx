import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js'
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.js'
import SendHorizontal from 'lucide-react/dist/esm/icons/send-horizontal.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js'

import { useCallback, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

import {
  COPILOT_TIME_WINDOWS,
  formatCopilotCitation,
  getCopilotConfidenceMeta,
  useChronicleCopilotAsk,
  useChronicleCopilotSummary,
} from '@/features/patients/hooks/useChronicleCopilot'

const QUICK_PROMPTS = Object.freeze([
  {
    id: 'summary_24h',
    label: 'Summarize last 24h',
    type: 'summary',
    timeWindow: '24h',
    focus: 'handoff',
  },
  {
    id: 'changes_prev',
    label: 'What changed since previous encounter?',
    type: 'ask',
    timeWindow: '7d',
    question: 'What changed since previous encounter?',
  },
  {
    id: 'risk_today',
    label: 'Risks to monitor today',
    type: 'ask',
    timeWindow: '24h',
    question: 'What risks should we monitor today?',
  },
])

function ResponseSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-[90%]" />
      <Skeleton className="h-4 w-[85%]" />
    </div>
  )
}

export default function ChronicleCopilotPanel({
  patientId,
  encounterId = null,
  patientName = 'Patient',
  variant = 'card',
  showHeading = true,
  className,
}) {
  const [question, setQuestion] = useState('')
  const [timeWindow, setTimeWindow] = useState('24h')
  const [response, setResponse] = useState(null)

  const summarizeMutation = useChronicleCopilotSummary()
  const askMutation = useChronicleCopilotAsk()

  const isBusy = summarizeMutation.isPending || askMutation.isPending
  const confidenceMeta = getCopilotConfidenceMeta(response?.confidence_band)
  const confidencePct =
    typeof response?.confidence === 'number' ? Math.round(response.confidence * 100) : null

  const summaryBlocks = useMemo(() => {
    if (response?.result?.mode !== 'summary') return []
    return Array.isArray(response.result.summary_blocks) ? response.result.summary_blocks : []
  }, [response])

  const supportingPoints = useMemo(() => {
    if (response?.result?.mode !== 'qa') return []
    return Array.isArray(response.result.supporting_points) ? response.result.supporting_points : []
  }, [response])

  const citationItems = useMemo(() => {
    const source = Array.isArray(response?.citations) ? response.citations : []
    return source.slice(0, 8)
  }, [response])

  const runSummary = useCallback(
    async ({ focus = 'handoff', selectedTimeWindow = timeWindow } = {}) => {
      if (!patientId) return

      try {
        const data = await summarizeMutation.mutateAsync({
          patientId,
          encounterId,
          timeWindow: selectedTimeWindow,
          focus,
        })
        setResponse(data)
      } catch (error) {
        toast.error(error?.message || 'Unable to generate chronicle summary.')
      }
    },
    [encounterId, patientId, summarizeMutation, timeWindow]
  )

  const runAsk = useCallback(
    async ({ text, selectedTimeWindow = timeWindow } = {}) => {
      if (!patientId) return
      const normalizedQuestion = String(text || '').trim()
      if (!normalizedQuestion) return

      try {
        const data = await askMutation.mutateAsync({
          patientId,
          encounterId,
          question: normalizedQuestion,
          timeWindow: selectedTimeWindow,
        })
        setResponse(data)
      } catch (error) {
        toast.error(error?.message || 'Unable to ask chronicle copilot.')
      }
    },
    [askMutation, encounterId, patientId, timeWindow]
  )

  const handleQuickPrompt = useCallback(
    async (item) => {
      if (item.type === 'summary') {
        await runSummary({ focus: item.focus, selectedTimeWindow: item.timeWindow })
        return
      }
      await runAsk({ text: item.question, selectedTimeWindow: item.timeWindow })
    },
    [runAsk, runSummary]
  )

  const handleAskSubmit = useCallback(async () => {
    const normalized = String(question || '').trim()
    if (!normalized) return
    await runAsk({ text: normalized })
    setQuestion('')
  }, [question, runAsk])

  const headingContent = showHeading ? (
    <>
      <div className="flex items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 font-display text-lg">
          <Sparkles className="size-4 text-amber-600" />
          Ask Chronicle
        </CardTitle>
        {response && (
          <Badge variant="outline" className={cn('text-[10px] font-mono', confidenceMeta.className)}>
            {confidenceMeta.label}
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Advisory AI support for {patientName}. Always validate with full chart review.
      </p>
    </>
  ) : null

  const timeWindowSelector = (
    <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
      {COPILOT_TIME_WINDOWS.map((window) => (
        <button
          key={window.value}
          type="button"
          onClick={() => setTimeWindow(window.value)}
          className={cn(
            'rounded-md px-2 py-1 font-mono text-[10px] transition-colors',
            timeWindow === window.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {window.label}
        </button>
      ))}
    </div>
  )

  const bodyContent = (
    <>
      <div className="space-y-2">
        {QUICK_PROMPTS.map((prompt) => (
          <Button
            key={prompt.id}
            type="button"
            variant="outline"
            className="h-8 w-full justify-start px-2 font-heading text-xs"
            onClick={() => handleQuickPrompt(prompt)}
            disabled={isBusy}
          >
            <MessageSquare className="mr-1.5 size-3" />
            {prompt.label}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              handleAskSubmit()
            }
          }}
          placeholder="Ask a patient-specific question..."
          className="h-8 font-mono text-xs"
          disabled={isBusy}
        />
        <Button
          type="button"
          size="icon"
          className="size-8 shrink-0"
          disabled={isBusy || !String(question || '').trim()}
          onClick={handleAskSubmit}
        >
          {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <SendHorizontal className="size-3.5" />}
        </Button>
      </div>

      {isBusy && <ResponseSkeleton />}

      {!isBusy && response && (
        <div className="space-y-3 rounded-lg border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            {confidencePct !== null && (
              <Badge variant="outline" className="font-mono text-[10px]">
                Confidence {confidencePct}%
              </Badge>
            )}
            {response?.result?.review_label && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {String(response.result.review_label).replace('_', ' ')}
              </Badge>
            )}
          </div>

          {response?.result?.review_message && (
            <p className="text-xs text-muted-foreground">{response.result.review_message}</p>
          )}

          {response?.result?.mode === 'summary' && (
            <div className="space-y-2">
              {summaryBlocks.map((block) => (
                <div key={block.key || block.title} className="rounded-md border border-border/70 p-2">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    {block.title}
                  </p>
                  <p className="mt-1 text-xs text-foreground">{block.content}</p>
                </div>
              ))}
              {(response?.result?.suggested_next_steps || []).length > 0 && (
                <div className="rounded-md border border-border/70 p-2">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Suggested Next Steps
                  </p>
                  <ul className="mt-1 space-y-1">
                    {(response.result.suggested_next_steps || []).slice(0, 3).map((item) => (
                      <li key={item} className="text-xs text-foreground">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {response?.result?.mode === 'qa' && (
            <div className="space-y-2">
              <p className="text-xs leading-relaxed text-foreground">{response?.result?.answer}</p>
              {supportingPoints.length > 0 && (
                <div className="rounded-md border border-border/70 p-2">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Supporting Points
                  </p>
                  <ul className="mt-1 space-y-1">
                    {supportingPoints.slice(0, 4).map((item) => (
                      <li key={item} className="text-xs text-foreground">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {citationItems.length > 0 && (
            <div className="space-y-1">
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                Citations
              </p>
              <div className="flex flex-wrap gap-1">
                {citationItems.map((citation) => (
                  <Badge
                    key={`${citation.type || citation.source}:${citation.id || citation.source_id}`}
                    variant="outline"
                    className="font-mono text-[10px]"
                  >
                    {formatCopilotCitation(citation)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )

  if (variant === 'plain') {
    return (
      <div className={cn('space-y-4', className)}>
        {headingContent && <div className="space-y-3">{headingContent}</div>}
        {timeWindowSelector}
        {bodyContent}
      </div>
    )
  }

  return (
    <Card className={cn('chronicle-card-glow border-border/70', className)}>
      <CardHeader className="space-y-3 pb-3">
        {headingContent}
        {timeWindowSelector}
      </CardHeader>

      <CardContent className="space-y-4 pt-0">{bodyContent}</CardContent>
    </Card>
  )
}
