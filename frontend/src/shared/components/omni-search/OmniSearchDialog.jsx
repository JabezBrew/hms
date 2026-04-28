import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import UserRound from 'lucide-react/dist/esm/icons/user-round.js'
import FileText from 'lucide-react/dist/esm/icons/file-text.js'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import ShieldX from 'lucide-react/dist/esm/icons/shield-x.js'
import Building2 from 'lucide-react/dist/esm/icons/building-2.js'
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js'
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js'
import BedDouble from 'lucide-react/dist/esm/icons/bed-double.js'
import IdCard from 'lucide-react/dist/esm/icons/id-card.js'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { ROLE_GROUPS, ROLES } from '@/shared/constants/roles'
import {
  buildOmniTargetHref,
  formatIntentLabel,
  useOmniExecutePreview,
  useOmniIntentPreview,
} from '@/shared/hooks/useOmniIntentPreview'
import { useOmniSearchResults } from '@/shared/hooks/useOmniSearchResults'
import { toast } from 'sonner'

import { useOmniSearch } from './OmniSearchProvider'
import { getOmniActionsForRole } from './omniActions'
import { getStaticPagesForRole, getStaticPathSetForRole } from './pageIndex'

const EMPTY_GROUPS = Object.freeze({
  recent_patients: [],
  patients: [],
  wards: [],
  encounters: [],
  appointments: [],
  admissions: [],
  staff: [],
})

const COMMAND_ITEM_CLASSNAME = cn(
  "cursor-pointer rounded-xl border border-transparent px-3 py-2.5",
  "transition-colors",
  "hover:bg-muted/40 hover:border-border/60",
  "data-[selected=true]:bg-muted/60 data-[selected=true]:border-border/70 data-[selected=true]:shadow-sm",
  "data-[disabled=true]:cursor-not-allowed"
)

const COMMAND_SEPARATOR_CLASSNAME = "bg-transparent divider-gradient"

const ICON_TONES = Object.freeze({
  amber: {
    container:
      "border-[oklch(0.75_0.18_55_/_0.18)] bg-[oklch(0.75_0.18_55_/_0.10)]",
    icon: "text-[oklch(0.75_0.18_55)]",
  },
  emerald: {
    container:
      "border-[oklch(0.70_0.17_155_/_0.18)] bg-[oklch(0.70_0.17_155_/_0.10)]",
    icon: "text-[oklch(0.70_0.17_155)]",
  },
  rose: {
    container:
      "border-[oklch(0.65_0.22_15_/_0.18)] bg-[oklch(0.65_0.22_15_/_0.10)]",
    icon: "text-[oklch(0.65_0.22_15)]",
  },
  sky: {
    container:
      "border-[oklch(0.70_0.15_230_/_0.18)] bg-[oklch(0.70_0.15_230_/_0.10)]",
    icon: "text-[oklch(0.70_0.15_230)]",
  },
})

function LeadingIcon({ Icon, tone = 'sky' }) {
  const selected = ICON_TONES[tone] || ICON_TONES.sky
  return (
    <span
      className={cn(
        "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border",
        selected.container
      )}
    >
      <Icon className={cn("size-4", selected.icon)} />
    </span>
  )
}

function tokenize(query) {
  return String(query).toLowerCase().split(/\s+/).filter(Boolean)
}

function scoreLocalItem({ label, keywords }, query) {
  const q = String(query).toLowerCase().trim()
  if (!q) return 0

  const labelLower = String(label || '').toLowerCase()
  let score = 0

  if (labelLower.startsWith(q)) score += 100
  else if (labelLower.includes(q)) score += 50

  const tokens = tokenize(q)
  for (const token of tokens) {
    if (!token) continue
    for (const kw of keywords || []) {
      if (String(kw).toLowerCase().includes(token)) {
        score += 10
        break
      }
    }
  }

  return score
}

function matchLocalItems(items, query, limit = 8) {
  const scored = []
  for (const item of items) {
    const score = scoreLocalItem(item, query)
    if (score > 0) scored.push({ item, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((x) => x.item)
}

function parseQuery(rawQuery, { isAdmin, isClinical }) {
  const raw = rawQuery ?? ''
  const input = String(raw).trimStart()
  const lower = input.toLowerCase()

  if (lower.startsWith('>')) {
    return {
      mode: 'pages',
      effectiveQuery: input.slice(1).trim(),
      types: null,
      patientAction: null,
      hint: null,
    }
  }

  if (lower.startsWith('#')) {
    return {
      mode: 'patients',
      effectiveQuery: input.slice(1).trim(),
      types: ['patients'],
      patientAction: null,
      hint: null,
    }
  }

  if (lower.startsWith('@')) {
    if (!isAdmin) {
      return {
        mode: 'staff',
        effectiveQuery: input.slice(1).trim(),
        types: null,
        patientAction: null,
        hint: 'Staff search is admin-only.',
        staffDisabled: true,
      }
    }

    return {
      mode: 'staff',
      effectiveQuery: input.slice(1).trim(),
      types: ['staff'],
      patientAction: null,
      hint: null,
      staffDisabled: false,
    }
  }

  const actionMatch = lower.match(/^(note|rx|wardround|consult)\s+(.*)$/)
  if (actionMatch && isClinical) {
    const cmd = actionMatch[1]
    const rest = (actionMatch[2] || '').trim()
    const actionMap = {
      note: 'add_note',
      rx: 'add_prescription',
      wardround: 'ward_round',
      consult: 'consultation',
    }
    return {
      mode: 'patient_action',
      effectiveQuery: rest,
      types: ['patients'],
      patientAction: actionMap[cmd] || null,
      hint: null,
    }
  }

  return {
    mode: 'all',
    effectiveQuery: input.trim(),
    types: null,
    patientAction: null,
    hint: null,
  }
}

function isUserClinical(role) {
  return ROLE_GROUPS.CLINICAL.includes(role)
}

function buildSuggestedCommands({ isAdmin, isClinical }) {
  const base = [
    { id: 'suggest.pages', label: '> pages', query: '> ' },
    { id: 'suggest.patients', label: '# patients', query: '# ' },
  ]

  if (isAdmin) {
    base.push({ id: 'suggest.staff', label: '@ staff', query: '@ ' })
  }

  if (isClinical) {
    base.push({ id: 'suggest.note', label: 'note <patient>', query: 'note ' })
    base.push({ id: 'suggest.rx', label: 'rx <patient>', query: 'rx ' })
    base.push({ id: 'suggest.wardround', label: 'wardround <patient>', query: 'wardround ' })
    base.push({ id: 'suggest.consult', label: 'consult <patient>', query: 'consult ' })
  }

  return base
}

const CONFIDENCE_STYLES = Object.freeze({
  normal: "border-emerald-200 bg-emerald-50 text-emerald-700",
  advisory: "border-amber-200 bg-amber-50 text-amber-700",
  needs_review: "border-rose-200 bg-rose-50 text-rose-700",
  fallback: "border-rose-200 bg-rose-50 text-rose-700",
})

function confidenceClass(band) {
  return CONFIDENCE_STYLES[band] || CONFIDENCE_STYLES.needs_review
}

function confidenceLabel(band) {
  if (band === 'normal') return 'Normal'
  if (band === 'advisory') return 'Advisory'
  if (band === 'fallback') return 'Fallback'
  return 'Needs Review'
}

export function OmniSearchDialog() {
  const inputRef = React.useRef(null)
  const navigate = useNavigate()

  const { user, facilityCode } = useAuth()
  const role = user?.role || ''
  const isAdmin = role === ROLES.ADMIN
  const isClinical = isUserClinical(role)

  const { open, setOpen, recentPages } = useOmniSearch()
  const [rawQuery, setRawQuery] = React.useState('')
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [pendingExecution, setPendingExecution] = React.useState(null)

  const parsed = React.useMemo(
    () => parseQuery(rawQuery, { isAdmin, isClinical }),
    [rawQuery, isAdmin, isClinical]
  )

  const effectiveQuery = parsed.effectiveQuery
  const mode = parsed.mode
  const [serverQuery, setServerQuery] = React.useState(effectiveQuery)

  const suggestedCommands = React.useMemo(
    () => buildSuggestedCommands({ isAdmin, isClinical }),
    [isAdmin, isClinical]
  )

  React.useEffect(() => {
    if (!open) {
      setRawQuery('')
      return
    }

    // Ensure focus moves to the input after the dialog portal is mounted.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  React.useEffect(() => {
    if (!open) {
      setServerQuery('')
      return
    }

    if (effectiveQuery.length === 0) {
      setServerQuery('')
      return
    }

    const id = window.setTimeout(() => setServerQuery(effectiveQuery), 150)
    return () => window.clearTimeout(id)
  }, [open, effectiveQuery])

  const isDebouncing = effectiveQuery !== serverQuery

  const serverEnabled =
    mode !== 'pages' && !(mode === 'staff' && parsed.staffDisabled) && Boolean(facilityCode)

  const { data, isLoading, isError } = useOmniSearchResults({
    open,
    facilityCode,
    q: serverQuery,
    // For empty query, always fetch recents without narrowing types (prevents duplicate calls
    // when switching between operator modes like `#`/`note` with no search text yet).
    types: serverQuery.length === 0 ? null : parsed.types,
    limit: 8,
    enabled: serverEnabled && !isDebouncing,
  })

  const groups = data?.groups || EMPTY_GROUPS
  const aiIntentEnabled = serverEnabled && !isDebouncing && mode === 'all'
  const {
    data: aiIntentData,
    isLoading: isAiIntentLoading,
    isError: isAiIntentError,
  } = useOmniIntentPreview({
    open,
    query: serverQuery,
    mode,
    enabled: aiIntentEnabled,
  })
  const executePreviewMutation = useOmniExecutePreview()

  const aiIntentResult = aiIntentData?.result || null
  const aiIntentPreview = aiIntentResult?.preview || null
  const aiIntentHref = buildOmniTargetHref(aiIntentResult?.target_route)
  const aiIntentBand = aiIntentData?.confidence_band || 'needs_review'
  const aiIntentFallback = Boolean(aiIntentResult?.fallback_to_legacy)
  const aiIntentBlocked = aiIntentPreview?.allowed === false
  const aiIntentConfirmationRequired = Boolean(aiIntentResult?.requires_confirmation)

  const actions = React.useMemo(() => {
    if (!effectiveQuery) return []
    if (mode !== 'all') return []
    return matchLocalItems(
      getOmniActionsForRole(role).map((a) => ({
        ...a,
        keywords: a.keywords || [],
      })),
      effectiveQuery,
      8
    )
  }, [role, effectiveQuery, mode])

  const pages = React.useMemo(() => {
    if (!effectiveQuery) return []
    if (mode !== 'all' && mode !== 'pages') return []
    return matchLocalItems(
      getStaticPagesForRole(role).map((p) => ({
        ...p,
        keywords: p.keywords || [],
      })),
      effectiveQuery,
      8
    )
  }, [role, effectiveQuery, mode])

  const allowedStaticPaths = React.useMemo(() => getStaticPathSetForRole(role), [role])
  const visibleRecentPages = React.useMemo(() => {
    const filtered = (recentPages || []).filter((p) => allowedStaticPaths.has(p.path))
    return filtered.slice(0, 8)
  }, [recentPages, allowedStaticPaths])

  const onSelectAndClose = React.useCallback(
    (to) => {
      setOpen(false)
      if (to) navigate(to)
    },
    [navigate, setOpen]
  )

  const closeConfirmation = React.useCallback(() => {
    setConfirmOpen(false)
    setPendingExecution(null)
  }, [])

  const handleConfirmExecution = React.useCallback(() => {
    const target = pendingExecution?.href
    closeConfirmation()
    if (target) {
      navigate(target)
    }
  }, [closeConfirmation, navigate, pendingExecution?.href])

  const handleRunAiPreview = React.useCallback(async () => {
    if (!serverQuery || serverQuery.length < 2) return
    if (aiIntentFallback) {
      toast.info('Low-confidence intent. Use standard results below.')
      return
    }
    if (aiIntentBlocked) {
      const reason = aiIntentPreview?.denial_reasons?.[0] || 'Action is not permitted.'
      toast.error(reason)
      return
    }

    const intentPayload = aiIntentResult
      ? {
          intent_type: aiIntentResult.intent_type,
          entities: aiIntentResult.entities || {},
          target_route: aiIntentResult.target_route || {},
          normalized_query: aiIntentResult.normalized_query || serverQuery,
          requires_confirmation: aiIntentResult.requires_confirmation,
          fallback_to_legacy: aiIntentResult.fallback_to_legacy,
          confidence: aiIntentData?.confidence,
        }
      : undefined

    try {
      const previewEnvelope = await executePreviewMutation.mutateAsync({
        text: serverQuery,
        intent: intentPayload,
      })
      const previewIntent = previewEnvelope?.result?.intent || {}
      const previewDecision = previewEnvelope?.result?.preview || {}
      const href = buildOmniTargetHref(previewIntent.target_route)

      if (!previewDecision.allowed) {
        const reason = previewDecision?.denial_reasons?.[0] || 'Action is not permitted.'
        toast.error(reason)
        return
      }

      if (previewDecision.requires_confirmation || previewIntent.requires_confirmation) {
        setOpen(false)
        setPendingExecution({
          href,
          intent: previewIntent,
          preview: previewDecision,
          confidenceBand: previewEnvelope?.confidence_band || aiIntentBand,
        })
        setConfirmOpen(true)
        return
      }

      onSelectAndClose(href)
    } catch (error) {
      toast.error(error?.message || 'Unable to preview AI command.')
    }
  }, [
    aiIntentBand,
    aiIntentBlocked,
    aiIntentData?.confidence,
    aiIntentFallback,
    aiIntentPreview?.denial_reasons,
    aiIntentResult,
    executePreviewMutation,
    onSelectAndClose,
    serverQuery,
    setOpen,
  ])

  const renderPageItem = React.useCallback(
    (page) => {
      if (!page?.path) return null
      return (
        <CommandItem
          key={`page:${page.path}`}
          value={`${page.label || ''} ${page.path}`.trim()}
          onSelect={() => onSelectAndClose(page.path)}
          className={COMMAND_ITEM_CLASSNAME}
        >
          <div className="flex min-w-0 items-start gap-3">
            <LeadingIcon Icon={FileText} tone="sky" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-heading text-sm font-semibold text-foreground">
                {page.label || page.path}
              </div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">{page.path}</div>
            </div>
          </div>
        </CommandItem>
      )
    },
    [onSelectAndClose]
  )

  const renderPatientItem = (patient, { action } = {}) => {
    const name = patient?.name || 'Patient'
    const mrn = patient?.medical_record_number
    const ward = patient?.current_ward
    const id = patient?.id
    if (!id) return null

    const destination = action ? `/patients/${id}?action=${action}` : `/patients/${id}`
    const actionLabel =
      action === 'add_note'
        ? 'Note'
        : action === 'add_prescription'
          ? 'Rx'
          : action === 'ward_round'
            ? 'Ward Round'
            : action === 'consultation'
              ? 'Consult'
              : null

    return (
      <CommandItem
        key={`patient:${id}:${action || 'view'}`}
        value={`${name} ${mrn || ''}`.trim()}
        onSelect={() => onSelectAndClose(destination)}
        className={COMMAND_ITEM_CLASSNAME}
      >
        <div className="flex min-w-0 items-start gap-3">
          <LeadingIcon Icon={UserRound} tone="sky" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-display text-base text-foreground">{name}</span>
              {actionLabel && (
                <span className="shrink-0 rounded-full border border-[oklch(0.75_0.18_55_/_0.25)] bg-[oklch(0.75_0.18_55_/_0.10)] px-2 py-0.5 font-mono text-[10px] text-[oklch(0.75_0.18_55)]">
                  {actionLabel}
                </span>
              )}
            </div>
            <div className="truncate font-mono text-[10px] text-muted-foreground">
              {mrn ? `MRN ${mrn}` : 'MRN unavailable'}
              {ward ? `  ·  ${ward}` : ''}
            </div>
          </div>
        </div>
      </CommandItem>
    )
  }

  const hasQuery = rawQuery.trim().length > 0
  const serverQueryReady = effectiveQuery.length === 0 || effectiveQuery.length >= 2
  const isSearching = isLoading || isDebouncing
  const showAiIntentPreview = hasQuery && mode === 'all' && serverEnabled && serverQueryReady && serverQuery.length >= 2
  const aiIntentDisabled = aiIntentFallback || aiIntentBlocked || executePreviewMutation.isPending
  const hasAiIntentContent =
    showAiIntentPreview && (isAiIntentLoading || isAiIntentError || Boolean(aiIntentResult))

  let aiIntentNote = null
  if (aiIntentFallback) {
    aiIntentNote = 'Low confidence. Falling back to standard results.'
  } else if (aiIntentBlocked) {
    aiIntentNote = aiIntentPreview?.denial_reasons?.[0] || 'Not allowed for this role or scope.'
  } else if (aiIntentConfirmationRequired) {
    aiIntentNote = 'Confirmation required before navigation.'
  }

  const patientPickerItems =
    (mode === 'patients' || mode === 'patient_action') && effectiveQuery.length < 2
      ? groups.recent_patients || []
      : groups.patients || []

  const showEmpty =
    hasQuery &&
    !hasAiIntentContent &&
    !isSearching &&
    !isError &&
    mode !== 'pages' &&
    actions.length === 0 &&
    pages.length === 0 &&
    (mode === 'patients' || mode === 'patient_action'
      ? patientPickerItems.length === 0
      : mode === 'staff'
        ? !parsed.staffDisabled && effectiveQuery.length >= 2 && (groups.staff || []).length === 0
        : (groups.patients || []).length === 0 &&
          (groups.wards || []).length === 0 &&
          (groups.encounters || []).length === 0 &&
          (groups.appointments || []).length === 0 &&
          (groups.admissions || []).length === 0 &&
          (groups.staff || []).length === 0)

  return (
    <>
      <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Omni Search"
      description="Search patients, pages, or actions."
      contentClassName="sm:max-w-2xl rounded-2xl border-border/60 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
      commandProps={{ shouldFilter: false }}
      commandClassName={cn(
        "bg-card text-foreground",
        "font-heading",
        // Input styling
        "[&_[data-slot=command-input-wrapper]]:h-14 [&_[data-slot=command-input-wrapper]]:gap-3 [&_[data-slot=command-input-wrapper]]:px-4",
        "[&_[data-slot=command-input-wrapper]]:bg-gradient-to-r [&_[data-slot=command-input-wrapper]]:from-muted/50 [&_[data-slot=command-input-wrapper]]:via-muted/20 [&_[data-slot=command-input-wrapper]]:to-muted/50",
        "[&_[data-slot=command-input]]:text-[15px]",
        // Group headings
        "[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest",
        // Items (sane defaults; fine-grained styles applied per item)
        "[&_[cmdk-item]]:rounded-xl"
      )}
    >
      <CommandInput
        ref={inputRef}
        placeholder="Type a command or search..."
        value={rawQuery}
        onValueChange={setRawQuery}
        className="font-heading tracking-tight"
      />

      <CommandList className="chronicle-scrollbar max-h-[420px]">
        {showEmpty && <CommandEmpty>No results found.</CommandEmpty>}

        {showAiIntentPreview && (
          <>
            <CommandGroup heading="AI Intent Preview">
              {isAiIntentLoading && (
                <CommandItem disabled value="AI intent loading" className={COMMAND_ITEM_CLASSNAME}>
                  <div className="flex min-w-0 items-start gap-3">
                    <LeadingIcon Icon={Sparkles} tone="amber" />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      Parsing intent...
                    </span>
                  </div>
                </CommandItem>
              )}

              {!isAiIntentLoading && isAiIntentError && (
                <CommandItem disabled value="AI intent error" className={COMMAND_ITEM_CLASSNAME}>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    AI intent unavailable. Use standard search results below.
                  </span>
                </CommandItem>
              )}

              {!isAiIntentLoading && !isAiIntentError && aiIntentResult && (
                <CommandItem
                  key={`ai-intent:${serverQuery}`}
                  value={`AI ${aiIntentResult.intent_type || ''} ${aiIntentHref}`}
                  onSelect={handleRunAiPreview}
                  disabled={aiIntentDisabled}
                  className={COMMAND_ITEM_CLASSNAME}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <LeadingIcon
                      Icon={
                        aiIntentBlocked || aiIntentFallback
                          ? ShieldX
                          : aiIntentConfirmationRequired
                            ? ShieldAlert
                            : ShieldCheck
                      }
                      tone={aiIntentBlocked || aiIntentFallback ? 'rose' : aiIntentConfirmationRequired ? 'amber' : 'emerald'}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-heading text-sm font-semibold text-foreground">
                          {formatIntentLabel(aiIntentResult.intent_type)}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px]",
                            confidenceClass(aiIntentBand)
                          )}
                        >
                          {confidenceLabel(aiIntentBand)}
                        </span>
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {aiIntentHref}
                      </div>
                      {aiIntentNote && (
                        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          {aiIntentNote}
                        </div>
                      )}
                    </div>
                  </div>
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />
          </>
        )}

        {!hasQuery && (
          <>
            <CommandGroup heading="Recent Patients">
              {(groups.recent_patients || []).map((p) => renderPatientItem(p))}
              {(groups.recent_patients || []).length === 0 && (
                <CommandItem disabled value="No recent patients" className={COMMAND_ITEM_CLASSNAME}>
                  <span className="font-mono text-[10px] text-muted-foreground">No recent patients</span>
                </CommandItem>
              )}
            </CommandGroup>

            <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />

            <CommandGroup heading="Recent Pages">
              {visibleRecentPages.map((p) => renderPageItem(p))}
              {visibleRecentPages.length === 0 && (
                <CommandItem disabled value="No recent pages" className={COMMAND_ITEM_CLASSNAME}>
                  <span className="font-mono text-[10px] text-muted-foreground">No recent pages</span>
                </CommandItem>
              )}
            </CommandGroup>

            <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />

            <CommandGroup heading="Suggested Commands">
              {suggestedCommands.map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  value={cmd.label}
                  onSelect={() => setRawQuery(cmd.query)}
                  className={COMMAND_ITEM_CLASSNAME}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <LeadingIcon Icon={Sparkles} tone="amber" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-heading text-sm font-semibold text-foreground">
                        {cmd.label}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">{cmd.query}</div>
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {hasQuery && mode === 'pages' && (
          <CommandGroup heading="Pages">
            {pages.map((p) => renderPageItem(p))}
            {pages.length === 0 && (
              <CommandItem disabled value="No matching pages" className={COMMAND_ITEM_CLASSNAME}>
                <span className="font-mono text-[10px] text-muted-foreground">No matching pages</span>
              </CommandItem>
            )}
          </CommandGroup>
        )}

        {hasQuery && mode === 'all' && actions.length > 0 && (
          <>
            <CommandGroup heading="Actions">
              {actions.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`${a.label} ${(a.keywords || []).join(' ')}`}
                  onSelect={() => {
                    setOpen(false)
                    a.run({ navigate, user })
                  }}
                  className={COMMAND_ITEM_CLASSNAME}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <LeadingIcon Icon={Sparkles} tone="amber" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-heading text-sm font-semibold text-foreground">
                        {a.label}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {(a.keywords || []).slice(0, 4).join(' · ')}
                      </div>
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />
          </>
        )}

        {hasQuery && mode === 'all' && pages.length > 0 && (
          <>
            <CommandGroup heading="Pages">
              {pages.map((p) => renderPageItem(p))}
            </CommandGroup>
            <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />
          </>
        )}

        {hasQuery &&
          serverEnabled &&
          serverQueryReady &&
          mode !== 'staff' &&
          mode !== 'pages' &&
          (mode === 'patients' || mode === 'patient_action' || mode === 'all') && (
            <>
              <CommandGroup
                heading={
                  mode === 'patients'
                    ? effectiveQuery.length < 2
                      ? 'Recent Patients'
                      : 'Patients'
                    : mode === 'patient_action'
                      ? effectiveQuery.length < 2
                        ? 'Recent Patients'
                        : 'Select Patient'
                      : 'Patients'
                }
              >
                {patientPickerItems.map((p) => renderPatientItem(p, { action: parsed.patientAction }))}
                {patientPickerItems.length === 0 && !isLoading && (
                  <CommandItem
                    disabled
                    value={effectiveQuery.length >= 2 ? 'No matching patients' : 'No recent patients'}
                    className={COMMAND_ITEM_CLASSNAME}
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {effectiveQuery.length >= 2 ? 'No matching patients' : 'No recent patients'}
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
              {mode === 'all' && <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />}
            </>
          )}

        {hasQuery && mode === 'all' && serverEnabled && serverQueryReady && (
          <>
            <CommandGroup heading="Wards">
              {(groups.wards || []).map((w) => (
                <CommandItem
                  key={`ward:${w.id}`}
                  value={`${w.name} ${w.ward_type || ''}`.trim()}
                  onSelect={() => onSelectAndClose(`/wards/${w.id}`)}
                  className={COMMAND_ITEM_CLASSNAME}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <LeadingIcon Icon={Building2} tone="emerald" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-heading text-sm font-semibold text-foreground">
                        {w.name}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {w.ward_type ? String(w.ward_type).toUpperCase() : 'WARD'}
                      </div>
                    </div>
                  </div>
                </CommandItem>
              ))}
              {(groups.wards || []).length === 0 && effectiveQuery.length >= 2 && !isLoading && (
                <CommandItem disabled value="No matching wards" className={COMMAND_ITEM_CLASSNAME}>
                  <span className="font-mono text-[10px] text-muted-foreground">No matching wards</span>
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />

            <CommandGroup heading="Encounters">
              {(groups.encounters || []).map((e) => (
                <CommandItem
                  key={`encounter:${e.id}`}
                  value={`${e.patient_name || ''} ${e.reason || ''}`.trim()}
                  onSelect={() => {
                    const to = ROLE_GROUPS.ENCOUNTER_WORKSPACE.includes(role)
                      ? `/encounters/${e.id}/workspace`
                      : `/encounters/${e.id}`
                    onSelectAndClose(to)
                  }}
                  className={COMMAND_ITEM_CLASSNAME}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <LeadingIcon Icon={Stethoscope} tone="amber" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-heading text-sm font-semibold text-foreground">
                        {e.patient_name || 'Encounter'}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {e.reason ? String(e.reason) : 'No reason recorded'}
                      </div>
                    </div>
                  </div>
                </CommandItem>
              ))}
              {(groups.encounters || []).length === 0 && effectiveQuery.length >= 2 && !isLoading && (
                <CommandItem disabled value="No matching encounters" className={COMMAND_ITEM_CLASSNAME}>
                  <span className="font-mono text-[10px] text-muted-foreground">No matching encounters</span>
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />

            <CommandGroup heading="Appointments">
              {(groups.appointments || []).map((a) => (
                <CommandItem
                  key={`appointment:${a.id}`}
                  value={`${a.patient_name || ''} ${a.practitioner_name || ''}`.trim()}
                  onSelect={() => onSelectAndClose(`/appointments/${a.id}`)}
                  className={COMMAND_ITEM_CLASSNAME}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <LeadingIcon Icon={CalendarClock} tone="sky" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-heading text-sm font-semibold text-foreground">
                        {a.patient_name || 'Appointment'}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {a.start_time ? new Date(a.start_time).toLocaleString() : ''}
                      </div>
                    </div>
                  </div>
                </CommandItem>
              ))}
              {(groups.appointments || []).length === 0 && effectiveQuery.length >= 2 && !isLoading && (
                <CommandItem disabled value="No matching appointments" className={COMMAND_ITEM_CLASSNAME}>
                  <span className="font-mono text-[10px] text-muted-foreground">No matching appointments</span>
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />

            <CommandGroup heading="Admissions">
              {(groups.admissions || []).map((a) => (
                <CommandItem
                  key={`admission:${a.id}`}
                  value={`${a.patient_name || ''} ${a.ward_name || ''}`.trim()}
                  onSelect={() => onSelectAndClose(`/admissions/${a.id}`)}
                  className={COMMAND_ITEM_CLASSNAME}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <LeadingIcon Icon={BedDouble} tone="emerald" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-heading text-sm font-semibold text-foreground">
                        {a.patient_name || 'Admission'}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {a.ward_name ? String(a.ward_name) : 'No ward'}
                        {a.bed_number ? `  ·  Bed ${a.bed_number}` : ''}
                      </div>
                    </div>
                  </div>
                </CommandItem>
              ))}
              {(groups.admissions || []).length === 0 && effectiveQuery.length >= 2 && !isLoading && (
                <CommandItem disabled value="No matching admissions" className={COMMAND_ITEM_CLASSNAME}>
                  <span className="font-mono text-[10px] text-muted-foreground">No matching admissions</span>
                </CommandItem>
              )}
            </CommandGroup>

            {isAdmin && (
              <>
                <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />
                <CommandGroup heading="Staff">
                  {(groups.staff || []).map((s) => (
                    <CommandItem
                      key={`staff:${s.id}`}
                      value={`${s.name || ''} ${s.employee_id || ''}`.trim()}
                      onSelect={() => onSelectAndClose(`/staff/${s.id}`)}
                      className={COMMAND_ITEM_CLASSNAME}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <LeadingIcon Icon={IdCard} tone="rose" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-heading text-sm font-semibold text-foreground">
                            {s.name || 'Staff'}
                          </div>
                          <div className="truncate font-mono text-[10px] text-muted-foreground">
                            {s.employee_id || ''}
                          </div>
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                  {(groups.staff || []).length === 0 && effectiveQuery.length >= 2 && !isLoading && (
                    <CommandItem disabled value="No matching staff" className={COMMAND_ITEM_CLASSNAME}>
                      <span className="font-mono text-[10px] text-muted-foreground">No matching staff</span>
                    </CommandItem>
                  )}
                </CommandGroup>
              </>
            )}
          </>
        )}

        {hasQuery && mode === 'staff' && (
          <CommandGroup heading="Staff">
            {parsed.staffDisabled && (
              <CommandItem disabled value="Staff search is admin-only" className={COMMAND_ITEM_CLASSNAME}>
                <span className="font-mono text-[10px] text-muted-foreground">{parsed.hint}</span>
              </CommandItem>
            )}
            {!parsed.staffDisabled && effectiveQuery.length < 2 && (
              <CommandItem disabled value="Type at least 2 characters" className={COMMAND_ITEM_CLASSNAME}>
                <span className="font-mono text-[10px] text-muted-foreground">
                  Type at least 2 characters to search staff
                </span>
              </CommandItem>
            )}
            {!parsed.staffDisabled &&
              effectiveQuery.length >= 2 &&
              (groups.staff || []).map((s) => (
                <CommandItem
                  key={`staff:${s.id}`}
                  value={`${s.name || ''} ${s.employee_id || ''}`.trim()}
                  onSelect={() => onSelectAndClose(`/staff/${s.id}`)}
                  className={COMMAND_ITEM_CLASSNAME}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <LeadingIcon Icon={IdCard} tone="rose" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-heading text-sm font-semibold text-foreground">
                        {s.name || 'Staff'}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {s.employee_id || ''}
                      </div>
                    </div>
                  </div>
                </CommandItem>
              ))}
            {!parsed.staffDisabled &&
              effectiveQuery.length >= 2 &&
              (groups.staff || []).length === 0 &&
              !isLoading && (
                <CommandItem disabled value="No matching staff" className={COMMAND_ITEM_CLASSNAME}>
                  <span className="font-mono text-[10px] text-muted-foreground">No matching staff</span>
                </CommandItem>
              )}
          </CommandGroup>
        )}

        {isLoading && hasQuery && (
          <CommandItem disabled value="Loading" className={COMMAND_ITEM_CLASSNAME}>
            <div className="flex min-w-0 items-start gap-3">
              <LeadingIcon Icon={Sparkles} tone="amber" />
              <span className="font-mono text-[10px] text-muted-foreground">Searching...</span>
            </div>
          </CommandItem>
        )}

        {isError && (
          <CommandItem disabled value="Error" className={COMMAND_ITEM_CLASSNAME}>
            <span className="font-mono text-[10px] text-muted-foreground">Search failed. Try again.</span>
          </CommandItem>
        )}
        </CommandList>

        <div className="border-t bg-muted/20 px-4 py-2 text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] tracking-tight">
            <span>Enter to open</span>
            <span className="opacity-50">·</span>
            <span>Esc to close</span>
            <span className="opacity-50">·</span>
            <span className="rounded-full border bg-card px-2 py-0.5 text-[oklch(0.70_0.15_230)]">
              &gt; pages
            </span>
            <span className="rounded-full border bg-card px-2 py-0.5 text-[oklch(0.75_0.18_55)]">
              # patients
            </span>
            <span
              className={cn(
                "rounded-full border bg-card px-2 py-0.5 text-[oklch(0.65_0.22_15)]",
                !isAdmin && "opacity-50"
              )}
            >
              @ staff
            </span>
          </div>
        </div>
      </CommandDialog>

      <AlertDialog open={confirmOpen} onOpenChange={(nextOpen) => (!nextOpen ? closeConfirmation() : setConfirmOpen(nextOpen))}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">
              Confirm Sensitive Action
            </AlertDialogTitle>
            <AlertDialogDescription>
              AI command preview indicates this navigation requires confirmation.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 font-mono text-[10px]",
                  confidenceClass(pendingExecution?.confidenceBand)
                )}
              >
                {confidenceLabel(pendingExecution?.confidenceBand)}
              </span>
              <span className="font-heading font-semibold text-foreground">
                {formatIntentLabel(pendingExecution?.intent?.intent_type)}
              </span>
            </div>
            <div className="mt-2 font-mono text-xs text-muted-foreground">
              {pendingExecution?.href}
            </div>
            {(pendingExecution?.preview?.denial_reasons || []).length > 0 && (
              <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-2 font-mono text-xs text-rose-700">
                {(pendingExecution?.preview?.denial_reasons || [])[0]}
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeConfirmation}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmExecution}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
