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
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js'
import ReceiptText from 'lucide-react/dist/esm/icons/receipt-text.js'
import Boxes from 'lucide-react/dist/esm/icons/boxes.js'
import RouteIcon from 'lucide-react/dist/esm/icons/route.js'
import GitPullRequestArrow from 'lucide-react/dist/esm/icons/git-pull-request-arrow.js'

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
import { useSystemCapabilities } from '@/hooks/useSystemQueries'
import { ROLE_GROUPS, ROLES } from '@/shared/constants/roles'
import {
  buildOmniTargetHref,
  formatIntentLabel,
  useOmniExecutePreview,
  useOmniIntentPreview,
} from '@/shared/hooks/useOmniIntentPreview'
import { useOmniSearchResults } from '@/shared/hooks/useOmniSearchResults'
import { toast } from 'sonner'

import { useOmniSearch } from './OmniSearchContext'
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
  visits: [],
  clinics: [],
  laboratory: [],
  billing: [],
  inventory: [],
  referrals: [],
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

const GENERIC_RESULT_GROUPS = Object.freeze([
  { heading: 'Visits', itemsKey: 'visits', Icon: RouteIcon, tone: 'amber', keyPrefix: 'visit' },
  { heading: 'Clinics', itemsKey: 'clinics', Icon: Building2, tone: 'emerald', keyPrefix: 'clinic' },
  { heading: 'Laboratory', itemsKey: 'laboratory', Icon: FlaskConical, tone: 'sky', keyPrefix: 'laboratory' },
  { heading: 'Billing', itemsKey: 'billing', Icon: ReceiptText, tone: 'amber', keyPrefix: 'billing' },
  { heading: 'Inventory', itemsKey: 'inventory', Icon: Boxes, tone: 'emerald', keyPrefix: 'inventory' },
  { heading: 'Referrals', itemsKey: 'referrals', Icon: GitPullRequestArrow, tone: 'rose', keyPrefix: 'referral' },
])

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

function GenericResultGroup({ heading, items, Icon, tone, keyPrefix, renderItem }) {
  if (!Array.isArray(items) || items.length === 0) return null

  return (
    <>
      <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />
      <CommandGroup heading={heading}>
        {items.map((item) => renderItem(item, { Icon, tone, keyPrefix }))}
      </CommandGroup>
    </>
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

function normalizeNameKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function buildPatientNameCounts(patients) {
  const counts = new Map()
  const seenPatientIds = new Set()
  for (const patient of patients || []) {
    if (patient?.id) {
      if (seenPatientIds.has(patient.id)) continue
      seenPatientIds.add(patient.id)
    }
    const key = normalizeNameKey(patient?.name)
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

function dedupePatientsById(patients) {
  const out = []
  const seen = new Set()
  for (const patient of patients || []) {
    const id = patient?.id
    if (id) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    out.push(patient)
  }
  return out
}

function formatPatientDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toISOString().slice(0, 10)
}

function formatPatientGender(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower === 'm' || lower === 'male') return 'Male'
  if (lower === 'f' || lower === 'female') return 'Female'
  return raw
}

function formatPatientStatus(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  return raw
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getPatientLocationLabel(patient) {
  const ward = patient?.current_ward || null
  const bedNumber = patient?.bed_number || patient?.current_bed || null
  const patientLocation = patient?.patient_location || null
  const admissionStatus = formatPatientStatus(patient?.admission_status)

  if (ward && bedNumber) return `${ward} · Bed ${bedNumber}`
  if (ward) return ward
  if (patientLocation) return patientLocation
  if (admissionStatus) return admissionStatus
  return 'Not currently admitted'
}

function getPatientCurrentLocationLabel(patient) {
  const ward = patient?.current_ward || null
  const bedNumber = patient?.bed_number || patient?.current_bed || null
  const patientLocation = patient?.patient_location || null

  if (ward && bedNumber) return `${ward} · Bed ${bedNumber}`
  if (ward) return ward
  if (patientLocation) return patientLocation
  return null
}

function buildPatientCareContextParts(patient) {
  const status = formatPatientStatus(patient?.admission_status)
  const location = getPatientCurrentLocationLabel(patient)
  if (location) return [status, location].filter(Boolean)
  if (status) return [status]
  return ['Not currently admitted']
}

function getPatientDuplicateCount(patient, nameCounts) {
  const key = normalizeNameKey(patient?.name)
  if (!key) return 0
  return nameCounts.get(key) || 0
}

function buildPatientIdentityParts(patient) {
  const mrn = patient?.medical_record_number ? `MRN ${patient.medical_record_number}` : null
  const dob = formatPatientDate(patient?.date_of_birth)
  const gender = formatPatientGender(patient?.gender)
  const location = getPatientLocationLabel(patient)

  return [
    mrn,
    dob ? `DOB ${dob}` : null,
    gender,
    location,
  ].filter(Boolean)
}

function buildPatientIdentityWarnings(patient) {
  const warnings = []
  if (!patient?.medical_record_number || !patient?.date_of_birth) {
    warnings.push('Identity needs verification')
  }
  if (patient?.match_reason === 'name_fuzzy') warnings.push('Fuzzy match')
  return warnings
}

function shouldConfirmPatientSelection(patient, { action, duplicateCount }) {
  if (!patient?.id) return false
  if (duplicateCount > 1) return true
  if (!patient?.medical_record_number || !patient?.date_of_birth) return true
  if (patient?.match_reason === 'name_fuzzy') return true
  return Boolean(action && patient?.match_reason && !['id_exact', 'id_prefix'].includes(patient.match_reason))
}

function buildDuplicateNameSummaries(patients, nameCounts) {
  const summaries = []
  const seen = new Set()
  for (const patient of patients || []) {
    const key = normalizeNameKey(patient?.name)
    if (!key || seen.has(key)) continue
    const count = nameCounts.get(key) || 0
    if (count <= 1) continue
    seen.add(key)
    summaries.push({
      key,
      name: patient?.name || 'this name',
      count,
    })
  }
  return summaries
}

function PatientIdentityNotice({ summaries }) {
  if (!Array.isArray(summaries) || summaries.length === 0) return null

  const summaryText = summaries
    .slice(0, 2)
    .map((summary) => `${summary.count} patients named ${summary.name}`)
    .join(' · ')
  const extraCount = summaries.length - 2

  return (
    <div
      role="note"
      className="mx-1 mb-1 rounded-lg border border-border/70 bg-muted/35 px-3 py-2"
    >
      <div className="min-w-0">
        <div className="font-heading text-xs font-semibold text-foreground">
          {summaryText}
          {extraCount > 0 ? ` · ${extraCount} more same-name group${extraCount === 1 ? '' : 's'}` : ''}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          Use MRN, DOB, sex, and location to choose the correct record.
        </div>
      </div>
    </div>
  )
}

function NoResultsItem({ value, children }) {
  return (
    <CommandItem disabled value={value} className={COMMAND_ITEM_CLASSNAME}>
      <span className="font-mono text-[10px] text-muted-foreground">{children}</span>
    </CommandItem>
  )
}

function PageCommandItem({ page, onSelectPage }) {
  if (!page?.path) return null

  return (
    <CommandItem
      key={`page:${page.path}`}
      value={`${page.label || ''} ${page.path}`.trim()}
      onSelect={() => onSelectPage(page.path)}
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
}

function getPatientActionLabel(action) {
  if (action === 'add_note') return 'Note'
  if (action === 'add_prescription') return 'Rx'
  if (action === 'ward_round') return 'Ward Round'
  if (action === 'consultation') return 'Consult'
  return null
}

function safeInternalHref(value, fallback = null) {
  const href = String(value || '').trim()
  if (!href || !href.startsWith('/') || href.startsWith('//')) return fallback
  return href
}

function splitHref(href) {
  const hashIndex = href.indexOf('#')
  const beforeHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : ''
  const queryIndex = beforeHash.indexOf('?')
  return {
    pathname: queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash,
    search: queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '',
    hash,
  }
}

function appendHrefSearchParam(href, key, value) {
  const safeHref = safeInternalHref(href)
  if (!safeHref) return null

  const { pathname, search, hash } = splitHref(safeHref)
  const params = new URLSearchParams(search)
  params.set(key, String(value))
  const nextSearch = params.toString()
  return `${pathname}${nextSearch ? `?${nextSearch}` : ''}${hash}`
}

function appendHrefPathSegment(href, segment) {
  const safeHref = safeInternalHref(href)
  if (!safeHref) return null

  const { pathname, search, hash } = splitHref(safeHref)
  const suffix = `/${segment}`
  const nextPathname = pathname.endsWith(suffix)
    ? pathname
    : `${pathname.replace(/\/+$/, '')}${suffix}`
  return `${nextPathname}${search ? `?${search}` : ''}${hash}`
}

function getResultHref(item, fallback = null) {
  return safeInternalHref(item?.route_path) || safeInternalHref(item?.href) || safeInternalHref(fallback)
}

function getPatientHref(patient, action) {
  const fallback = patient?.id ? `/patients/${patient.id}` : null
  const href = getResultHref(patient, fallback)
  if (!href) return null
  return action ? appendHrefSearchParam(href, 'action', action) : href
}

function PatientCommandItem({ patient, action, patientNameCounts, onSelectPatient, onConfirmPatient }) {
  const name = patient?.name || 'Patient'
  const id = patient?.id
  const destination = getPatientHref(patient, action)
  if (!id || !destination) return null

  const duplicateCount = getPatientDuplicateCount(patient, patientNameCounts)
  const identityParts = buildPatientIdentityParts(patient)
  const identityWarnings = buildPatientIdentityWarnings(patient)
  const actionLabel = getPatientActionLabel(action)
  const identifierParts = [
    patient?.medical_record_number ? `MRN ${patient.medical_record_number}` : null,
    patient?.date_of_birth ? `DOB ${formatPatientDate(patient.date_of_birth)}` : null,
    formatPatientGender(patient?.gender),
  ].filter(Boolean)
  const careContextParts = buildPatientCareContextParts(patient)
  const duplicateAssistiveText =
    duplicateCount > 1 ? `${duplicateCount} patients share this name. Confirm DOB and MRN before opening.` : null
  const patientAriaLabel = [
    name,
    duplicateAssistiveText,
    identifierParts.join(', '),
    careContextParts.join(', '),
  ].filter(Boolean).join('. ')

  return (
    <CommandItem
      key={`patient:${id}:${action || 'view'}`}
      value={`${name} ${patient?.medical_record_number || ''} ${patient?.date_of_birth || ''}`.trim()}
      aria-label={patientAriaLabel}
      onSelect={() => {
        if (shouldConfirmPatientSelection(patient, { action, duplicateCount })) {
          onConfirmPatient({
            kind: 'patient_identity',
            href: destination,
            patient,
            actionLabel,
            duplicateCount,
            identityParts,
            identityWarnings,
          })
          return
        }
        onSelectPatient(destination)
      }}
      className={COMMAND_ITEM_CLASSNAME}
    >
      <div className="flex min-w-0 items-start gap-3">
        <LeadingIcon Icon={UserRound} tone="sky" />
        <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)] sm:items-start">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate font-display text-base text-foreground">{name}</span>
              {actionLabel && (
                <span className="shrink-0 rounded-full border border-[oklch(0.75_0.18_55_/_0.25)] bg-[oklch(0.75_0.18_55_/_0.10)] px-2 py-0.5 font-mono text-[10px] text-[oklch(0.75_0.18_55)]">
                  {actionLabel}
                </span>
              )}
              {identityWarnings.map((warning) => (
                <span
                  key={`${id}:${warning}`}
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px]",
                    warning === 'Identity needs verification'
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  )}
                >
                  {warning}
                </span>
              ))}
            </div>
            <div className="break-words font-mono text-[10px] text-muted-foreground">
              {identifierParts.length > 0 ? identifierParts.join('  ·  ') : 'No verified identifiers available'}
            </div>
          </div>
          <div className="min-w-0 font-mono text-[10px] text-muted-foreground sm:text-right">
            <div className="break-words text-foreground/75">{careContextParts[0]}</div>
            <div className="break-words">{careContextParts.slice(1).join('  ·  ')}</div>
          </div>
          {identityParts.length === 0 && (
            <span className="sr-only">No verified identifiers available</span>
          )}
        </div>
      </div>
    </CommandItem>
  )
}

function GenericCommandItem({ item, Icon = FileText, tone = 'sky', keyPrefix = 'search', onSelectResult }) {
  const href = getResultHref(item)
  const label = item?.label || item?.title || 'Result'
  const description = item?.description || item?.subtitle || item?.status_label || href
  if (!href || !item?.id) return null

  return (
    <CommandItem
      key={`${keyPrefix}:${item.id}`}
      value={`${label} ${description || ''}`.trim()}
      onSelect={() => onSelectResult(href)}
      className={COMMAND_ITEM_CLASSNAME}
    >
      <div className="flex min-w-0 items-start gap-3">
        <LeadingIcon Icon={Icon} tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-heading text-sm font-semibold text-foreground">
            {label}
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {description}
          </div>
        </div>
      </div>
    </CommandItem>
  )
}

function AiIntentPreviewGroup({ preview, onRunPreview }) {
  const {
    show,
    isLoading,
    isError,
    result,
    href,
    confidenceBand,
    isBlocked,
    isFallback,
    confirmationRequired,
    note,
    disabled,
    serverQuery,
  } = preview

  if (!show) return null

  return (
    <>
      <CommandGroup heading="AI Intent Preview">
        {isLoading && (
          <CommandItem disabled value="AI intent loading" className={COMMAND_ITEM_CLASSNAME}>
            <div className="flex min-w-0 items-start gap-3">
              <LeadingIcon Icon={Sparkles} tone="amber" />
              <span className="font-mono text-[10px] text-muted-foreground">
                Parsing intent…
              </span>
            </div>
          </CommandItem>
        )}

        {!isLoading && isError && (
          <CommandItem disabled value="AI intent error" className={COMMAND_ITEM_CLASSNAME}>
            <span className="font-mono text-[10px] text-muted-foreground">
              AI intent unavailable. Use standard search results below.
            </span>
          </CommandItem>
        )}

        {!isLoading && !isError && result && (
          <CommandItem
            key={`ai-intent:${serverQuery}`}
            value={`AI ${result.intent_type || ''} ${href}`}
            onSelect={onRunPreview}
            disabled={disabled}
            className={COMMAND_ITEM_CLASSNAME}
          >
            <div className="flex min-w-0 items-start gap-3">
              <LeadingIcon
                Icon={
                  isBlocked || isFallback
                    ? ShieldX
                    : confirmationRequired
                      ? ShieldAlert
                      : ShieldCheck
                }
                tone={isBlocked || isFallback ? 'rose' : confirmationRequired ? 'amber' : 'emerald'}
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-heading text-sm font-semibold text-foreground">
                    {formatIntentLabel(result.intent_type)}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px]",
                      confidenceClass(confidenceBand)
                    )}
                  >
                    {confidenceLabel(confidenceBand)}
                  </span>
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {href}
                </div>
                {note && (
                  <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                    {note}
                  </div>
                )}
              </div>
            </div>
          </CommandItem>
        )}
      </CommandGroup>
      <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />
    </>
  )
}

function EmptyOmniSearchGroups({
  hasQuery,
  recentPatients,
  visibleRecentPages,
  suggestedCommands,
  patientNameCounts,
  onSelectPage,
  onSelectPatient,
  onConfirmPatient,
  onChooseCommand,
}) {
  if (hasQuery) return null
  const visibleRecentPatients = dedupePatientsById(recentPatients)
  const duplicateSummaries = buildDuplicateNameSummaries(visibleRecentPatients, patientNameCounts)

  return (
    <>
      <CommandGroup heading="Recent Patients">
        <PatientIdentityNotice summaries={duplicateSummaries} />
        {visibleRecentPatients.map((patient) => (
          <PatientCommandItem
            key={`recent-patient:${patient?.id}`}
            patient={patient}
            patientNameCounts={patientNameCounts}
            onSelectPatient={onSelectPatient}
            onConfirmPatient={onConfirmPatient}
          />
        ))}
        {visibleRecentPatients.length === 0 && (
          <NoResultsItem value="No recent patients">No recent patients</NoResultsItem>
        )}
      </CommandGroup>

      <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />

      <CommandGroup heading="Recent Pages">
        {visibleRecentPages.map((page) => (
          <PageCommandItem key={`recent-page:${page.path}`} page={page} onSelectPage={onSelectPage} />
        ))}
        {visibleRecentPages.length === 0 && (
          <NoResultsItem value="No recent pages">No recent pages</NoResultsItem>
        )}
      </CommandGroup>

      <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />

      <CommandGroup heading="Suggested Commands">
        {suggestedCommands.map((cmd) => (
          <CommandItem
            key={cmd.id}
            value={cmd.label}
            onSelect={() => onChooseCommand(cmd.query)}
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
  )
}

function PagesOnlyResults({ hasQuery, mode, pages, onSelectPage }) {
  if (!(hasQuery && mode === 'pages')) return null

  return (
    <CommandGroup heading="Pages">
      {pages.map((page) => (
        <PageCommandItem key={`page-only:${page.path}`} page={page} onSelectPage={onSelectPage} />
      ))}
      {pages.length === 0 && (
        <NoResultsItem value="No matching pages">No matching pages</NoResultsItem>
      )}
    </CommandGroup>
  )
}

function ActionResultsGroup({ hasQuery, mode, actions, onRunAction }) {
  if (!(hasQuery && mode === 'all' && actions.length > 0)) return null

  return (
    <>
      <CommandGroup heading="Actions">
        {actions.map((action) => (
          <CommandItem
            key={action.id}
            value={`${action.label} ${(action.keywords || []).join(' ')}`}
            onSelect={() => onRunAction(action)}
            className={COMMAND_ITEM_CLASSNAME}
          >
            <div className="flex min-w-0 items-start gap-3">
              <LeadingIcon Icon={Sparkles} tone="amber" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-heading text-sm font-semibold text-foreground">
                  {action.label}
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {(action.keywords || []).slice(0, 4).join(' · ')}
                </div>
              </div>
            </div>
          </CommandItem>
        ))}
      </CommandGroup>
      <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />
    </>
  )
}

function PageResultsGroup({ hasQuery, mode, pages, onSelectPage }) {
  if (!(hasQuery && mode === 'all' && pages.length > 0)) return null

  return (
    <>
      <CommandGroup heading="Pages">
        {pages.map((page) => (
          <PageCommandItem key={`page-result:${page.path}`} page={page} onSelectPage={onSelectPage} />
        ))}
      </CommandGroup>
      <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />
    </>
  )
}

function getPatientGroupHeading({ mode, effectiveQuery }) {
  if (mode === 'patients') return effectiveQuery.length < 2 ? 'Recent Patients' : 'Patients'
  if (mode === 'patient_action') return effectiveQuery.length < 2 ? 'Recent Patients' : 'Select Patient'
  return 'Patients'
}

function PatientResultsGroup({
  hasQuery,
  serverEnabled,
  serverQueryReady,
  mode,
  effectiveQuery,
  patientPickerItems,
  patientAction,
  isLoading,
  patientNameCounts,
  onSelectPatient,
  onConfirmPatient,
}) {
  const isPatientMode = mode === 'patients' || mode === 'patient_action' || mode === 'all'
  if (!(hasQuery && serverEnabled && serverQueryReady && mode !== 'staff' && mode !== 'pages' && isPatientMode)) {
    return null
  }
  const visiblePatientPickerItems = dedupePatientsById(patientPickerItems)
  const duplicateSummaries = buildDuplicateNameSummaries(visiblePatientPickerItems, patientNameCounts)

  return (
    <>
      <CommandGroup heading={getPatientGroupHeading({ mode, effectiveQuery })}>
        <PatientIdentityNotice summaries={duplicateSummaries} />
        {visiblePatientPickerItems.map((patient) => (
          <PatientCommandItem
            key={`patient-result:${patient?.id}:${patientAction || 'view'}`}
            patient={patient}
            action={patientAction}
            patientNameCounts={patientNameCounts}
            onSelectPatient={onSelectPatient}
            onConfirmPatient={onConfirmPatient}
          />
        ))}
        {visiblePatientPickerItems.length === 0 && !isLoading && (
          <NoResultsItem value={effectiveQuery.length >= 2 ? 'No matching patients' : 'No recent patients'}>
            {effectiveQuery.length >= 2 ? 'No matching patients' : 'No recent patients'}
          </NoResultsItem>
        )}
      </CommandGroup>
      {mode === 'all' && <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />}
    </>
  )
}

function WardsGroup({ wards, effectiveQuery, isLoading, onSelectResult }) {
  return (
    <>
      <CommandGroup heading="Wards">
        {(wards || []).map((ward) => (
          <CommandItem
            key={`ward:${ward.id}`}
            value={`${ward.name} ${ward.ward_type || ''}`.trim()}
            onSelect={() => onSelectResult(getResultHref(ward, `/wards/${ward.id}`))}
            className={COMMAND_ITEM_CLASSNAME}
          >
            <div className="flex min-w-0 items-start gap-3">
              <LeadingIcon Icon={Building2} tone="emerald" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-heading text-sm font-semibold text-foreground">
                  {ward.name}
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {ward.ward_type ? String(ward.ward_type).toUpperCase() : 'WARD'}
                </div>
              </div>
            </div>
          </CommandItem>
        ))}
        {(wards || []).length === 0 && effectiveQuery.length >= 2 && !isLoading && (
          <NoResultsItem value="No matching wards">No matching wards</NoResultsItem>
        )}
      </CommandGroup>
      <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />
    </>
  )
}

function EncountersGroup({ encounters, role, effectiveQuery, isLoading, onSelectResult }) {
  return (
    <>
      <CommandGroup heading="Encounters">
        {(encounters || []).map((encounter) => (
          <CommandItem
            key={`encounter:${encounter.id}`}
            value={`${encounter.patient_name || ''} ${encounter.reason || ''}`.trim()}
            onSelect={() => {
              const href = getResultHref(encounter, `/encounters/${encounter.id}`)
              const to = ROLE_GROUPS.ENCOUNTER_WORKSPACE.includes(role)
                ? appendHrefPathSegment(href, 'workspace')
                : href
              onSelectResult(to)
            }}
            className={COMMAND_ITEM_CLASSNAME}
          >
            <div className="flex min-w-0 items-start gap-3">
              <LeadingIcon Icon={Stethoscope} tone="amber" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-heading text-sm font-semibold text-foreground">
                  {encounter.patient_name || 'Encounter'}
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {encounter.reason ? String(encounter.reason) : 'No reason recorded'}
                </div>
              </div>
            </div>
          </CommandItem>
        ))}
        {(encounters || []).length === 0 && effectiveQuery.length >= 2 && !isLoading && (
          <NoResultsItem value="No matching encounters">No matching encounters</NoResultsItem>
        )}
      </CommandGroup>
      <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />
    </>
  )
}

function AppointmentsGroup({ appointments, effectiveQuery, isLoading, onSelectResult }) {
  return (
    <>
      <CommandGroup heading="Appointments">
        {(appointments || []).map((appointment) => (
          <CommandItem
            key={`appointment:${appointment.id}`}
            value={`${appointment.patient_name || ''} ${appointment.practitioner_name || ''}`.trim()}
            onSelect={() => onSelectResult(getResultHref(appointment, `/appointments/${appointment.id}`))}
            className={COMMAND_ITEM_CLASSNAME}
          >
            <div className="flex min-w-0 items-start gap-3">
              <LeadingIcon Icon={CalendarClock} tone="sky" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-heading text-sm font-semibold text-foreground">
                  {appointment.patient_name || 'Appointment'}
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {appointment.start_time ? new Date(appointment.start_time).toLocaleString() : ''}
                </div>
              </div>
            </div>
          </CommandItem>
        ))}
        {(appointments || []).length === 0 && effectiveQuery.length >= 2 && !isLoading && (
          <NoResultsItem value="No matching appointments">No matching appointments</NoResultsItem>
        )}
      </CommandGroup>
      <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />
    </>
  )
}

function AdmissionsGroup({ admissions, effectiveQuery, isLoading, onSelectResult }) {
  return (
    <>
      <CommandGroup heading="Admissions">
        {(admissions || []).map((admission) => (
          <CommandItem
            key={`admission:${admission.id}`}
            value={`${admission.patient_name || ''} ${admission.ward_name || ''}`.trim()}
            onSelect={() => onSelectResult(getResultHref(admission, `/admissions/${admission.id}`))}
            className={COMMAND_ITEM_CLASSNAME}
          >
            <div className="flex min-w-0 items-start gap-3">
              <LeadingIcon Icon={BedDouble} tone="emerald" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-heading text-sm font-semibold text-foreground">
                  {admission.patient_name || 'Admission'}
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {admission.ward_name ? String(admission.ward_name) : 'No ward'}
                  {admission.bed_number ? `  ·  Bed ${admission.bed_number}` : ''}
                </div>
              </div>
            </div>
          </CommandItem>
        ))}
        {(admissions || []).length === 0 && effectiveQuery.length >= 2 && !isLoading && (
          <NoResultsItem value="No matching admissions">No matching admissions</NoResultsItem>
        )}
      </CommandGroup>
    </>
  )
}

function StaffResultItems({ staff, effectiveQuery, isLoading, onSelectResult }) {
  return (
    <>
      {(staff || []).map((member) => (
        <CommandItem
          key={`staff:${member.id}`}
          value={`${member.name || ''} ${member.employee_id || ''}`.trim()}
          onSelect={() => onSelectResult(getResultHref(member, `/staff/${member.id}`))}
          className={COMMAND_ITEM_CLASSNAME}
        >
          <div className="flex min-w-0 items-start gap-3">
            <LeadingIcon Icon={IdCard} tone="rose" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-heading text-sm font-semibold text-foreground">
                {member.name || 'Staff'}
              </div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {member.employee_id || ''}
              </div>
            </div>
          </div>
        </CommandItem>
      ))}
      {(staff || []).length === 0 && effectiveQuery.length >= 2 && !isLoading && (
        <NoResultsItem value="No matching staff">No matching staff</NoResultsItem>
      )}
    </>
  )
}

function AdminStaffGroup({ isAdmin, staff, effectiveQuery, isLoading, onSelectResult }) {
  if (!isAdmin) return null

  return (
    <>
      <CommandSeparator className={COMMAND_SEPARATOR_CLASSNAME} />
      <CommandGroup heading="Staff">
        <StaffResultItems
          staff={staff}
          effectiveQuery={effectiveQuery}
          isLoading={isLoading}
          onSelectResult={onSelectResult}
        />
      </CommandGroup>
    </>
  )
}

function AllModeServerGroups({
  hasQuery,
  mode,
  serverEnabled,
  serverQueryReady,
  groups,
  role,
  isAdmin,
  effectiveQuery,
  isLoading,
  onSelectResult,
}) {
  if (!(hasQuery && mode === 'all' && serverEnabled && serverQueryReady)) return null

  return (
    <>
      <WardsGroup
        wards={groups.wards}
        effectiveQuery={effectiveQuery}
        isLoading={isLoading}
        onSelectResult={onSelectResult}
      />
      <EncountersGroup
        encounters={groups.encounters}
        role={role}
        effectiveQuery={effectiveQuery}
        isLoading={isLoading}
        onSelectResult={onSelectResult}
      />
      <AppointmentsGroup
        appointments={groups.appointments}
        effectiveQuery={effectiveQuery}
        isLoading={isLoading}
        onSelectResult={onSelectResult}
      />
      <AdmissionsGroup
        admissions={groups.admissions}
        effectiveQuery={effectiveQuery}
        isLoading={isLoading}
        onSelectResult={onSelectResult}
      />
      <AdminStaffGroup
        isAdmin={isAdmin}
        staff={groups.staff}
        effectiveQuery={effectiveQuery}
        isLoading={isLoading}
        onSelectResult={onSelectResult}
      />
      {GENERIC_RESULT_GROUPS.map((group) => (
        <GenericResultGroup
          key={group.keyPrefix}
          heading={group.heading}
          items={groups[group.itemsKey]}
          Icon={group.Icon}
          tone={group.tone}
          keyPrefix={group.keyPrefix}
          renderItem={(item, options) => (
            <GenericCommandItem
              key={`${options.keyPrefix}:${item?.id}`}
              item={item}
              Icon={options.Icon}
              tone={options.tone}
              keyPrefix={options.keyPrefix}
              onSelectResult={onSelectResult}
            />
          )}
        />
      ))}
    </>
  )
}

function StaffModeGroup({ hasQuery, mode, parsed, effectiveQuery, staff, isLoading, onSelectResult }) {
  if (!(hasQuery && mode === 'staff')) return null

  return (
    <CommandGroup heading="Staff">
      {parsed.staffDisabled && (
        <NoResultsItem value="Staff search is admin-only">{parsed.hint}</NoResultsItem>
      )}
      {!parsed.staffDisabled && effectiveQuery.length < 2 && (
        <NoResultsItem value="Type at least 2 characters">
          Type at least 2 characters to search staff
        </NoResultsItem>
      )}
      {!parsed.staffDisabled && effectiveQuery.length >= 2 && (
        <StaffResultItems
          staff={staff}
          effectiveQuery={effectiveQuery}
          isLoading={isLoading}
          onSelectResult={onSelectResult}
        />
      )}
    </CommandGroup>
  )
}

function SearchStatusItems({ isLoading, isError, hasQuery }) {
  return (
    <>
      {isLoading && hasQuery && (
        <CommandItem disabled value="Loading" className={COMMAND_ITEM_CLASSNAME}>
          <div className="flex min-w-0 items-start gap-3">
            <LeadingIcon Icon={Sparkles} tone="amber" />
            <span className="font-mono text-[10px] text-muted-foreground">Searching…</span>
          </div>
        </CommandItem>
      )}

      {isError && (
        <CommandItem disabled value="Error" className={COMMAND_ITEM_CLASSNAME}>
          <span className="font-mono text-[10px] text-muted-foreground">Search failed. Try again.</span>
        </CommandItem>
      )}
    </>
  )
}

function OmniSearchFooter({ isAdmin }) {
  return (
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
  )
}

function OmniSearchConfirmationDialog({
  open,
  pendingExecution,
  onOpenChange,
  onCancel,
  onConfirm,
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-xl">
            {pendingExecution?.kind === 'patient_identity' ? 'Confirm Patient Identity' : 'Confirm Sensitive Action'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingExecution?.kind === 'patient_identity'
              ? 'Verify the identifiers before opening this chart.'
              : 'AI command preview indicates this navigation requires confirmation.'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {pendingExecution?.kind === 'patient_identity' ? (
          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg text-foreground">
                {pendingExecution?.patient?.name || 'Patient'}
              </span>
              {pendingExecution?.actionLabel && (
                <span className="rounded-full border border-[oklch(0.75_0.18_55_/_0.25)] bg-[oklch(0.75_0.18_55_/_0.10)] px-2 py-0.5 font-mono text-[10px] text-[oklch(0.75_0.18_55)]">
                  {pendingExecution.actionLabel}
                </span>
              )}
            </div>
            <div className="mt-2 break-words font-mono text-xs text-muted-foreground">
              {(pendingExecution?.identityParts || []).length > 0
                ? pendingExecution.identityParts.join('  ·  ')
                : 'No verified identifiers available'}
            </div>
            {pendingExecution?.duplicateCount > 1 && (
              <div className="mt-3 rounded-md border border-border/70 bg-background/70 px-3 py-2 font-mono text-[10px] text-muted-foreground">
                This name appears on {pendingExecution.duplicateCount} records. Confirm DOB and MRN before continuing.
              </div>
            )}
            {(pendingExecution?.identityWarnings || []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {pendingExecution.identityWarnings.map((warning) => (
                  <span
                    key={`confirm:${warning}`}
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-mono text-[10px]",
                      warning === 'Fuzzy match'
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                    )}
                  >
                    {warning}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
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
        )}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function useOmniSearchDialogModel({ inputRef, navigate }) {
  const { user, facilityCode } = useAuth()
  const role = user?.role || ''
  const isAdmin = role === ROLES.ADMIN
  const isClinical = isUserClinical(role)

  const {
    open,
    setOpen,
    recentPages,
    draftQuery,
    setDraftQuery,
    clearDraftQuery,
  } = useOmniSearch()
  const [rawQuery, setRawQueryState] = React.useState(() => draftQuery || '')
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [pendingExecution, setPendingExecution] = React.useState(null)
  const { data: deploymentCapabilities } = useSystemCapabilities({ enabled: Boolean(user && open) })
  const aiOmniEnabled = deploymentCapabilities?.features?.ai_omni_nl === true

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

  const setRawQuery = React.useCallback((value) => {
    setRawQueryState(value)
    setDraftQuery(value)
  }, [setDraftQuery])

  const closeDialogAndClearDraft = React.useCallback(() => {
    clearDraftQuery()
    setRawQueryState('')
    setOpen(false)
  }, [clearDraftQuery, setOpen])

  const handleDialogOpenChange = React.useCallback(
    (nextOpen) => {
      setOpen(nextOpen)
    },
    [setOpen]
  )

  React.useEffect(() => {
    if (!open) return

    // Ensure focus moves to the input after the dialog portal is mounted.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open, inputRef])

  React.useEffect(() => {
    if (open) {
      setRawQueryState(draftQuery || '')
    }
  }, [draftQuery, open])

  React.useEffect(() => {
    if (!open || effectiveQuery.length === 0) {
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
  const aiIntentEnabled = aiOmniEnabled && serverEnabled && !isDebouncing && mode === 'all'
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
      closeDialogAndClearDraft()
      if (to) navigate(to)
    },
    [closeDialogAndClearDraft, navigate]
  )

  const closeConfirmation = React.useCallback(() => {
    setConfirmOpen(false)
    setPendingExecution(null)
  }, [])

  const handleConfirmExecution = React.useCallback(() => {
    const target = pendingExecution?.href
    closeConfirmation()
    if (target) {
      clearDraftQuery()
      setRawQueryState('')
      navigate(target)
    }
  }, [clearDraftQuery, closeConfirmation, navigate, pendingExecution?.href])

  const patientNameCounts = React.useMemo(
    () => buildPatientNameCounts([...(groups.recent_patients || []), ...(groups.patients || [])]),
    [groups.patients, groups.recent_patients]
  )

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

  const handleConfirmPatient = React.useCallback(
    (execution) => {
      setOpen(false)
      setPendingExecution(execution)
      setConfirmOpen(true)
    },
    [setOpen]
  )

  const handleRunAction = React.useCallback(
    (action) => {
      closeDialogAndClearDraft()
      action.run({ navigate, user })
    },
    [closeDialogAndClearDraft, navigate, user]
  )

  const handleConfirmationOpenChange = React.useCallback(
    (nextOpen) => (!nextOpen ? closeConfirmation() : setConfirmOpen(nextOpen)),
    [closeConfirmation]
  )

  const hasQuery = rawQuery.trim().length > 0
  const serverQueryReady = effectiveQuery.length === 0 || effectiveQuery.length >= 2
  const isSearching = isLoading || isDebouncing
  const showAiIntentPreview = aiOmniEnabled && hasQuery && mode === 'all' && serverEnabled && serverQueryReady && serverQuery.length >= 2
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

  const aiIntentPreviewGroup = {
    show: showAiIntentPreview,
    isLoading: isAiIntentLoading,
    isError: isAiIntentError,
    result: aiIntentResult,
    href: aiIntentHref,
    confidenceBand: aiIntentBand,
    isBlocked: aiIntentBlocked,
    isFallback: aiIntentFallback,
    confirmationRequired: aiIntentConfirmationRequired,
    note: aiIntentNote,
    disabled: aiIntentDisabled,
    serverQuery,
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
          (groups.staff || []).length === 0 &&
          (groups.visits || []).length === 0 &&
          (groups.clinics || []).length === 0 &&
          (groups.laboratory || []).length === 0 &&
          (groups.billing || []).length === 0 &&
          (groups.inventory || []).length === 0 &&
          (groups.referrals || []).length === 0)

  return {
    actions,
    aiIntentBand,
    aiIntentBlocked,
    aiIntentConfirmationRequired,
    aiIntentDisabled,
    aiIntentFallback,
    aiIntentHref,
    aiIntentNote,
    aiIntentPreviewGroup,
    aiIntentResult,
    closeConfirmation,
    confirmOpen,
    effectiveQuery,
    groups,
    handleConfirmExecution,
    handleConfirmPatient,
    handleDialogOpenChange,
    handleConfirmationOpenChange,
    handleRunAction,
    handleRunAiPreview,
    hasQuery,
    isAdmin,
    isAiIntentError,
    isAiIntentLoading,
    isError,
    isLoading,
    mode,
    onSelectAndClose,
    open,
    pages,
    parsed,
    patientNameCounts,
    patientPickerItems,
    pendingExecution,
    rawQuery,
    role,
    serverEnabled,
    serverQuery,
    serverQueryReady,
    setRawQuery,
    showAiIntentPreview,
    showEmpty,
    suggestedCommands,
    visibleRecentPages,
  }
}

export function OmniSearchDialog() {
  const inputRef = React.useRef(null)
  const navigate = useNavigate()
  const dialog = useOmniSearchDialogModel({ inputRef, navigate })

  return (
    <>
      <CommandDialog
      open={dialog.open}
      onOpenChange={dialog.handleDialogOpenChange}
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
        value={dialog.rawQuery}
        onValueChange={dialog.setRawQuery}
        className="font-heading tracking-tight"
      />

      <CommandList className="chronicle-scrollbar max-h-[420px]">
        {dialog.showEmpty && <CommandEmpty>No results found.</CommandEmpty>}

        <AiIntentPreviewGroup
          preview={dialog.aiIntentPreviewGroup}
          onRunPreview={dialog.handleRunAiPreview}
        />

        <EmptyOmniSearchGroups
          hasQuery={dialog.hasQuery}
          recentPatients={dialog.groups.recent_patients}
          visibleRecentPages={dialog.visibleRecentPages}
          suggestedCommands={dialog.suggestedCommands}
          patientNameCounts={dialog.patientNameCounts}
          onSelectPage={dialog.onSelectAndClose}
          onSelectPatient={dialog.onSelectAndClose}
          onConfirmPatient={dialog.handleConfirmPatient}
          onChooseCommand={dialog.setRawQuery}
        />

        <PagesOnlyResults
          hasQuery={dialog.hasQuery}
          mode={dialog.mode}
          pages={dialog.pages}
          onSelectPage={dialog.onSelectAndClose}
        />

        <ActionResultsGroup
          hasQuery={dialog.hasQuery}
          mode={dialog.mode}
          actions={dialog.actions}
          onRunAction={dialog.handleRunAction}
        />

        <PageResultsGroup
          hasQuery={dialog.hasQuery}
          mode={dialog.mode}
          pages={dialog.pages}
          onSelectPage={dialog.onSelectAndClose}
        />

        <PatientResultsGroup
          hasQuery={dialog.hasQuery}
          serverEnabled={dialog.serverEnabled}
          serverQueryReady={dialog.serverQueryReady}
          mode={dialog.mode}
          effectiveQuery={dialog.effectiveQuery}
          patientPickerItems={dialog.patientPickerItems}
          patientAction={dialog.parsed.patientAction}
          isLoading={dialog.isLoading}
          patientNameCounts={dialog.patientNameCounts}
          onSelectPatient={dialog.onSelectAndClose}
          onConfirmPatient={dialog.handleConfirmPatient}
        />

        <AllModeServerGroups
          hasQuery={dialog.hasQuery}
          mode={dialog.mode}
          serverEnabled={dialog.serverEnabled}
          serverQueryReady={dialog.serverQueryReady}
          groups={dialog.groups}
          role={dialog.role}
          isAdmin={dialog.isAdmin}
          effectiveQuery={dialog.effectiveQuery}
          isLoading={dialog.isLoading}
          onSelectResult={dialog.onSelectAndClose}
        />

        <StaffModeGroup
          hasQuery={dialog.hasQuery}
          mode={dialog.mode}
          parsed={dialog.parsed}
          effectiveQuery={dialog.effectiveQuery}
          staff={dialog.groups.staff}
          isLoading={dialog.isLoading}
          onSelectResult={dialog.onSelectAndClose}
        />

        <SearchStatusItems
          isLoading={dialog.isLoading}
          isError={dialog.isError}
          hasQuery={dialog.hasQuery}
        />
        </CommandList>

        <OmniSearchFooter isAdmin={dialog.isAdmin} />
      </CommandDialog>

      <OmniSearchConfirmationDialog
        open={dialog.confirmOpen}
        pendingExecution={dialog.pendingExecution}
        onOpenChange={dialog.handleConfirmationOpenChange}
        onCancel={dialog.closeConfirmation}
        onConfirm={dialog.handleConfirmExecution}
      />
    </>
  )
}
