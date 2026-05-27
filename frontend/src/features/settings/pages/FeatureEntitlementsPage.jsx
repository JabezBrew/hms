import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import Boxes from 'lucide-react/dist/esm/icons/boxes.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useFacilities } from '@/hooks/useFacilityQueries'
import {
  useCreateFeatureEntitlement,
  useDeleteFeatureEntitlement,
  useFeatureEntitlements,
  useSystemCapabilities,
  useUpdateFeatureEntitlement,
} from '@/hooks/useSystemQueries'
import { PageHeader } from '@/shared/components/page/PageHeader'
import { PageShell } from '@/shared/components/page/PageShell'
import { usePageMeta } from '@/shared/hooks/usePageMeta'

const GLOBAL_SCOPE = 'global'
const FACILITY_SCOPE = 'facility'
const NO_FACILITY = '__none__'
const EMPTY_ARRAY = []
const EMPTY_OBJECT = {}

const SOURCE_LABELS = {
  deployment_profile: 'Deployment profile',
  global_override: 'Global override',
  facility_override: 'Facility override',
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || source || 'Unknown'
}

function idMatches(left, right) {
  return String(left || '') === String(right || '')
}

function FeatureEntitlementsHeader({ onBack }) {
  return (
    <PageHeader
      title={(
        <span className="flex items-center gap-3 sm:gap-4">
          <span className="p-2.5 sm:p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Boxes className="size-6 sm:h-7 sm:w-7 text-primary" aria-hidden="true" />
          </span>
          Feature Entitlements
        </span>
      )}
      description="Control clinic, hospital, and network product modules without changing the codebase."
      contentClassName="max-w-6xl mx-auto w-full"
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="-ml-2 font-mono text-xs"
      >
        <ArrowLeft className="size-4 mr-2" />
        Back to Settings
      </Button>
    </PageHeader>
  )
}

function FeatureToggleCard({ feature, state, toggleDisabled, isSaving, onToggle, onRemove }) {
  return (
    <div
      className="rounded-xl border border-border bg-background/60 p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h3 className="font-heading text-sm text-foreground">
            {feature.label}
          </h3>
          <p className="font-mono text-[11px] text-muted-foreground">
            {feature.key} · {feature.kind}
          </p>
        </div>
        <Switch
          checked={state.checked}
          disabled={toggleDisabled}
          onCheckedChange={(checked) => onToggle(feature, checked)}
          aria-label={`Toggle ${feature.label}`}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <span
            className={`inline-flex font-mono text-[10px] uppercase tracking-wider rounded-full px-2 py-1 ${
              state.checked
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-rose-500/10 text-rose-400'
            }`}
          >
            {state.checked ? 'Enabled' : 'Disabled'}
          </span>
          <p className="font-mono text-[11px] text-muted-foreground">
            Source: {state.source}
          </p>
        </div>
        {state.selectedOverride ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRemove(state.selectedOverride.id, feature.label)}
            disabled={isSaving}
            className="font-mono text-xs"
          >
            <RotateCcw className="mr-2 size-3.5" />
            Inherit
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function FeatureToggleGrid({ features, columnsClassName, stateForFeature, toggleDisabled, isSaving, onToggle, onRemove }) {
  return (
    <div className={columnsClassName}>
      {features.map((feature) => (
        <FeatureToggleCard
          key={feature.key}
          feature={feature}
          state={stateForFeature(feature)}
          toggleDisabled={toggleDisabled}
          isSaving={isSaving}
          onToggle={onToggle}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}

function ModuleTogglesPanel({
  capabilities,
  moduleFeatures,
  isLoading,
  toggleContext,
}) {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div>
          <h2 className="font-display text-xl text-foreground">Module Toggles</h2>
          <p className="text-sm text-muted-foreground">
            Profile: {capabilities?.profile_label || capabilities?.deployment_profile || 'Unknown'}
          </p>
        </div>
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Current facility {capabilities?.facility_code || 'global'}
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading module toggles…</p>
      ) : moduleFeatures.length === 0 ? (
        <p className="text-sm text-muted-foreground">No product modules are available.</p>
      ) : (
        <FeatureToggleGrid
          features={moduleFeatures}
          columnsClassName="grid grid-cols-1 md:grid-cols-2 gap-3"
          {...toggleContext}
        />
      )}
    </section>
  )
}

function ToggleScopePanel({
  scope,
  facilityId,
  facilities,
  facilityRequired,
  reason,
  onScopeChange,
  onFacilityChange,
  onReasonChange,
}) {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6 space-y-4">
      <div>
        <h2 className="font-display text-xl text-foreground">Toggle Scope</h2>
        <p className="text-sm text-muted-foreground">
          Facility overrides win over global overrides and deployment defaults.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="font-mono text-xs uppercase">Scope</Label>
        <Select value={scope} onValueChange={onScopeChange}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GLOBAL_SCOPE}>Global</SelectItem>
            <SelectItem value={FACILITY_SCOPE}>Facility</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {scope === FACILITY_SCOPE && (
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase">Facility</Label>
          <Select value={facilityId} onValueChange={onFacilityChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose facility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_FACILITY}>Choose facility</SelectItem>
              {facilities.map((facility) => (
                <SelectItem key={facility.id} value={facility.id}>
                  {facility.code} · {facility.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {facilityRequired ? (
            <p className="text-xs text-amber-500">
              Choose a facility before changing facility-level toggles.
            </p>
          ) : null}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="reason" className="font-mono text-xs uppercase">Change reason</Label>
        <Input
          id="reason"
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          maxLength={255}
          placeholder="Optional operational reason"
        />
      </div>
    </section>
  )
}

function ActiveOverridesPanel({ overrides, deletePending, onRemove }) {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <h2 className="font-display text-xl text-foreground mb-4">Active Overrides</h2>
      <div className="space-y-3">
        {overrides.length === 0 ? (
          <p className="text-sm text-muted-foreground">No database overrides are active.</p>
        ) : overrides.map((override) => (
          <div key={override.id} className="rounded-xl border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-heading text-sm">{override.feature_label}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {override.scope}
                  {override.facility_code ? ` · ${override.facility_code}` : ''}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemove(override.id, override.feature_label)}
                disabled={deletePending}
                aria-label={`Remove ${override.feature_key} override`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <p className="mt-2 font-mono text-[11px]">
              {override.is_enabled ? 'Enabled' : 'Disabled'}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function AdvancedFeatureControls({ advancedFeatures, isLoading, toggleContext }) {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6 xl:col-span-2">
      <div className="mb-5">
        <h2 className="font-display text-xl text-foreground">Advanced Feature Controls</h2>
        <p className="text-sm text-muted-foreground">
          Platform, subfeature, and integration toggles that support the commercial modules.
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading feature controls…</p>
      ) : advancedFeatures.length === 0 ? (
        <p className="text-sm text-muted-foreground">No advanced features are available.</p>
      ) : (
        <FeatureToggleGrid
          features={advancedFeatures}
          columnsClassName="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
          {...toggleContext}
        />
      )}
    </section>
  )
}

export default function FeatureEntitlementsPage() {
  const navigate = useNavigate()
  const [scope, setScope] = useState(GLOBAL_SCOPE)
  const [facilityId, setFacilityId] = useState(NO_FACILITY)
  const [reason, setReason] = useState('')

  const { data: capabilities, isLoading: capabilitiesLoading } = useSystemCapabilities()
  const { data: entitlements, isLoading: entitlementsLoading } = useFeatureEntitlements({ page_size: 200 })
  const { data: facilities = [] } = useFacilities({ includeInactive: true })
  const createOverride = useCreateFeatureEntitlement()
  const updateOverride = useUpdateFeatureEntitlement()
  const deleteOverride = useDeleteFeatureEntitlement()

  const featureManifest = capabilities?.feature_manifest || EMPTY_ARRAY
  const effectiveFeatures = capabilities?.features || EMPTY_OBJECT
  const featureSources = capabilities?.feature_sources || EMPTY_OBJECT
  const overrides = entitlements?.results || entitlements || EMPTY_ARRAY
  const isLoading = capabilitiesLoading || entitlementsLoading
  const isSaving = createOverride.isPending || updateOverride.isPending || deleteOverride.isPending
  const selectedFacility = facilities.find((facility) => idMatches(facility.id, facilityId))
  const facilityRequired = scope === FACILITY_SCOPE && facilityId === NO_FACILITY

  const sortedFeatures = useMemo(
    () => featureManifest.toSorted((a, b) => a.label.localeCompare(b.label)),
    [featureManifest]
  )
  const moduleFeatures = useMemo(
    () => sortedFeatures.filter((feature) => feature.kind === 'module'),
    [sortedFeatures]
  )
  const advancedFeatures = useMemo(
    () => sortedFeatures.filter((feature) => feature.kind !== 'module'),
    [sortedFeatures]
  )

  const globalOverrideByFeature = useMemo(() => {
    const byFeature = new Map()
    for (const override of overrides) {
      if (override.scope === GLOBAL_SCOPE) {
        byFeature.set(override.feature_key, override)
      }
    }
    return byFeature
  }, [overrides])

  const selectedOverrideByFeature = useMemo(() => {
    const byFeature = new Map()
    overrides.forEach((override) => {
      if (scope === GLOBAL_SCOPE && override.scope === GLOBAL_SCOPE) {
        byFeature.set(override.feature_key, override)
        return
      }

      if (scope !== FACILITY_SCOPE || override.scope !== FACILITY_SCOPE || facilityId === NO_FACILITY) {
        return
      }

      const matchesFacilityId = idMatches(override.facility, facilityId)
      const matchesFacilityCode = selectedFacility?.code && override.facility_code === selectedFacility.code
      if (matchesFacilityId || matchesFacilityCode) {
        byFeature.set(override.feature_key, override)
      }
    })
    return byFeature
  }, [facilityId, overrides, scope, selectedFacility?.code])

  const pageMeta = usePageMeta({
    title: 'Feature Entitlements | HMS',
    breadcrumbs: [
      { label: 'Settings', href: '/settings' },
      { label: 'Feature Entitlements' },
    ],
  })

  const resolveFeatureState = (feature) => {
    const selectedOverride = selectedOverrideByFeature.get(feature.key)
    const inheritedGlobalOverride = scope === FACILITY_SCOPE
      ? globalOverrideByFeature.get(feature.key)
      : null
    const checked = selectedOverride?.is_enabled
      ?? inheritedGlobalOverride?.is_enabled
      ?? effectiveFeatures[feature.key] === true
    const source = selectedOverride
      ? `${scope === GLOBAL_SCOPE ? 'Global' : selectedFacility?.code || 'Facility'} override`
      : inheritedGlobalOverride
      ? 'Global override'
      : sourceLabel(featureSources[feature.key])

    return {
      checked,
      source,
      selectedOverride,
    }
  }

  const saveFeatureOverride = async (feature, nextEnabled) => {
    if (facilityRequired) {
      toast.error('Choose a facility before setting a facility override')
      return
    }

    const selectedOverride = selectedOverrideByFeature.get(feature.key)
    const cleanReason = reason.trim()

    try {
      if (selectedOverride) {
        await updateOverride.mutateAsync({
          id: selectedOverride.id,
          data: {
            is_enabled: nextEnabled,
            reason: cleanReason,
          },
        })
      } else {
        await createOverride.mutateAsync({
          scope,
          facility: scope === FACILITY_SCOPE ? facilityId : null,
          feature_key: feature.key,
          is_enabled: nextEnabled,
          reason: cleanReason,
        })
      }
      toast.success(`${feature.label} ${nextEnabled ? 'enabled' : 'disabled'}`)
    } catch (error) {
      toast.error(error.message || `Failed to update ${feature.label}`)
    }
  }

  const removeOverride = async (overrideId, label = 'Feature') => {
    try {
      await deleteOverride.mutateAsync(overrideId)
      toast.success(`${label} override removed`)
    } catch (error) {
      toast.error(error.message || 'Failed to remove feature override')
    }
  }

  const toggleContext = {
    stateForFeature: resolveFeatureState,
    toggleDisabled: isLoading || isSaving || facilityRequired,
    isSaving,
    onToggle: saveFeatureOverride,
    onRemove: removeOverride,
  }

  return (
    <PageShell>
      {pageMeta}
      <FeatureEntitlementsHeader onBack={() => navigate('/settings')} />

      <main className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
          <ModuleTogglesPanel
            capabilities={capabilities}
            moduleFeatures={moduleFeatures}
            isLoading={isLoading}
            toggleContext={toggleContext}
          />

          <aside className="space-y-6">
            <ToggleScopePanel
              scope={scope}
              facilityId={facilityId}
              facilities={facilities}
              facilityRequired={facilityRequired}
              reason={reason}
              onScopeChange={setScope}
              onFacilityChange={setFacilityId}
              onReasonChange={setReason}
            />

            <ActiveOverridesPanel
              overrides={overrides}
              deletePending={deleteOverride.isPending}
              onRemove={removeOverride}
            />
          </aside>

          <AdvancedFeatureControls
            advancedFeatures={advancedFeatures}
            isLoading={isLoading}
            toggleContext={toggleContext}
          />
        </div>
      </main>
    </PageShell>
  )
}
