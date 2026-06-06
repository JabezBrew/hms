import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { keyWith } from '@/shared/lib/queryKeys'
import { useAuth } from '@/lib/auth'
import { onboardingApi } from '../api'
import {
  configureOnboardingEventTransport,
  emitOnboardingEvent,
  setOnboardingEventEnabled,
} from '../events'

const SUPPORTED_ROLES = new Set([
  'doctor',
  'inpatient_doctor',
  'physician',
  'practitioner',
])

const REMOVED_STEP_IDS = new Set([
  'tpl_04_open_chart_templates',
  'tpl_05_create_chart_template',
  'tpl_06_use_chart_template',
])

const FLOW_COPY = {
  doctor_core_v1: {
    title: 'Doctor Essentials',
    description: 'Complete the core actions used in daily charting.',
  },
  doctor_templates_v1: {
    title: 'Template Quickstart',
    description: 'Create and apply note templates for faster documentation.',
  },
}

const STEP_COPY = {
  core_01_start: {
    title: 'Open My Work',
    description: 'Begin from your care-context landing page.',
    action: { label: 'Open My Work', route: '/my-work' },
    ui: {
      target: '[data-onboarding="nav-my-work"]',
      placement: 'right',
      title: 'Open My Work',
      body: 'Click here to begin the onboarding flow.',
      arrow: true,
      scroll_into_view: true,
    },
  },
  core_02_open_registry: {
    title: 'Open patient directory',
    description: 'Go to the patient directory or your assigned patient list.',
    action: { label: 'Open Patients', route: '/patients' },
    ui: {
      target: '[data-onboarding="nav-patients"]',
      placement: 'right',
      title: 'Open Patient Directory',
      body: 'Click Patient Directory in the sidebar.',
      arrow: true,
      scroll_into_view: true,
    },
  },
  core_03_open_patient_chart: {
    title: 'Open a patient chart',
    description: 'Select any patient and load the chronicle.',
    action: { label: 'Open Patients', route: '/patients' },
    ui: {
      target: '[data-onboarding="patient-list-row"]',
      placement: 'left',
      title: 'Open A Patient Chart',
      body: 'Click a patient row to open their chronicle.',
      arrow: true,
      scroll_into_view: true,
    },
  },
  core_04_timeline_filters: {
    title: 'Use timeline filters',
    description: 'Switch to Notes, then back to All for one patient.',
    action: { label: 'Return To Chart', route: '/patients' },
    ui: {
      target: '[data-onboarding="chronicle-filter-group"]',
      placement: 'bottom',
      title: 'Use Chronicle Filters',
      body: 'Use Notes, then switch back to All to complete this step.',
      arrow: true,
      scroll_into_view: true,
    },
  },
  core_05_create_note: {
    title: 'Create a clinical note',
    description: 'Add a note from the patient chronicle.',
    action: { label: 'Open Patients', route: '/patients' },
    ui: {
      target: '[data-onboarding="chronicle-add-note"]',
      placement: 'bottom',
      title: 'Create A Note',
      body: 'Click Add Note to create a clinical note.',
      arrow: true,
      scroll_into_view: true,
    },
  },
  core_06_place_order: {
    title: 'Place an order',
    description: 'Create a prescription or submit a lab order.',
    action: { label: 'Open Patients', route: '/patients' },
    ui: {
      target: '[data-onboarding="chronicle-prescribe"]',
      placement: 'bottom',
      title: 'Place An Order',
      body: 'Click Prescribe (or use More for lab orders).',
      arrow: true,
      scroll_into_view: true,
    },
  },
  tpl_01_open_note_templates: {
    title: 'Open note templates',
    description: 'Go to clinical note templates.',
    action: { label: 'Open Note Templates', route: '/clinical-notes/templates' },
    ui: {
      target: '[data-onboarding="nav-clinical-content-toggle"]',
      placement: 'right',
      title: 'Open Clinical Content',
      body: 'Use this menu to access note and chart templates.',
      arrow: true,
      scroll_into_view: true,
    },
  },
  tpl_02_create_note_template: {
    title: 'Create a note template',
    description: 'Build a note template with at least 3 sections.',
    action: { label: 'Create Note Template', route: '/clinical-notes/templates' },
    ui: {
      target: '[data-onboarding="note-template-create"]',
      placement: 'left',
      title: 'Create Note Template',
      body: 'Click Create Template, then build one with 3+ sections.',
      arrow: true,
      scroll_into_view: true,
    },
  },
  tpl_03_use_note_template: {
    title: 'Use your note template',
    description: 'Create a note using the template you just created.',
    action: { label: 'Open Patients', route: '/patients' },
    ui: {
      target: '[data-onboarding="chronicle-add-note"]',
      placement: 'bottom',
      title: 'Use The Template',
      body: 'Open Add Note and create a note with your new template.',
      arrow: true,
      scroll_into_view: true,
    },
  },
  tpl_04_open_chart_templates: {
    title: 'Open chart templates',
    description: 'Go to chart templates.',
    action: { label: 'Open Chart Templates', route: '/charts/templates' },
    ui: {
      target: '[data-onboarding="nav-clinical-content-toggle"]',
      placement: 'right',
      title: 'Open Clinical Content',
      body: 'Open Clinical Content to access chart templates.',
      arrow: true,
      scroll_into_view: true,
    },
  },
  tpl_05_create_chart_template: {
    title: 'Create a chart template',
    description: 'Create a chart template you can assign to a patient.',
    action: { label: 'Create Chart Template', route: '/charts/builder' },
    ui: {
      target: '[data-onboarding="chart-template-create"]',
      placement: 'left',
      title: 'Create Chart Template',
      body: 'Click New Template to create a chart template.',
      arrow: true,
      scroll_into_view: true,
    },
  },
  tpl_06_use_chart_template: {
    title: 'Use your chart template',
    description: 'Assign the template and record one chart entry.',
    action: { label: 'Open Patients', route: '/patients' },
    ui: {
      target: '[data-onboarding="chronicle-more-actions"]',
      placement: 'bottom',
      title: 'Assign Then Record',
      body: 'Use More actions to assign a chart, then record a chart entry.',
      arrow: true,
      scroll_into_view: true,
    },
  },
}

const onboardingKeys = {
  flows: (role) => keyWith('onboarding', 'flows', role),
  progress: (role, flowKeys) => keyWith('onboarding', 'progress', role, flowKeys),
}

function getRole(user) {
  return user?.role || user?.user_type || null
}

function normalizeSteps(flow) {
  const steps = flow?.definition?.steps
  if (!Array.isArray(steps)) {
    return []
  }
  return steps.filter((step) => !REMOVED_STEP_IDS.has(step?.id))
}

function canAutoStartFlow(flow, progressByKey) {
  const startConfig = flow?.definition?.start || {}
  if (startConfig.mode === 'manual_or_after') {
    const requiredFlowKey = startConfig.after_flow
    const requiredFlow = requiredFlowKey ? progressByKey[requiredFlowKey] : null
    return Boolean(requiredFlow && requiredFlow.is_flow_completed)
  }
  return true
}

function mergeStepMeta(step) {
  const fallback = STEP_COPY[step?.id] || {}
  const stepAction = step?.action || {}
  const fallbackAction = fallback.action || {}
  const stepUi = step?.ui && typeof step.ui === 'object' ? step.ui : {}
  const fallbackUi = fallback.ui && typeof fallback.ui === 'object' ? fallback.ui : {}
  const mergedUi = { ...fallbackUi, ...stepUi }

  const action = {
    label: stepAction.label || fallbackAction.label || 'Open Step',
    route: stepAction.route || fallbackAction.route || null,
  }

  return {
    id: step?.id || null,
    title: step?.title || fallback.title || 'Next Step',
    description: step?.description || fallback.description || '',
    action,
    ui: Object.keys(mergedUi).length > 0 ? mergedUi : null,
  }
}

export function useOnboardingRuntime() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const role = getRole(user)
  const enabled = Boolean(user?.id && role && SUPPORTED_ROLES.has(role))

  const flowsQuery = useQuery({
    queryKey: onboardingKeys.flows(role),
    queryFn: onboardingApi.getActiveFlows,
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const flows = useMemo(() => {
    const payload = flowsQuery.data?.flows
    return Array.isArray(payload) ? payload : []
  }, [flowsQuery.data])

  const flowKeys = useMemo(() => flows.map((flow) => flow.flow_key), [flows])
  const flowKeyToken = useMemo(() => flowKeys.join(','), [flowKeys])

  const progressQuery = useQuery({
    queryKey: onboardingKeys.progress(role, flowKeyToken),
    queryFn: () => onboardingApi.getProgress(flowKeys),
    enabled: enabled && flowKeys.length > 0,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  })

  const progressList = useMemo(() => {
    const payload = progressQuery.data?.progress
    return Array.isArray(payload) ? payload : []
  }, [progressQuery.data])

  const progressByKey = useMemo(() => {
    return progressList.reduce((acc, snapshot) => {
      acc[snapshot.flow_key] = snapshot
      return acc
    }, {})
  }, [progressList])

  const startProgress = useMutation({
    mutationFn: onboardingApi.startProgress,
    onSuccess: (snapshot) => {
      emitOnboardingEvent('onboarding.flow_started', {
        flow_key: snapshot.flow_key,
        flow_version: snapshot.flow_version,
      })
      void queryClient.invalidateQueries({
        queryKey: onboardingKeys.progress(role, flowKeyToken),
      })
    },
  })

  const skipStep = useMutation({
    mutationFn: onboardingApi.skipStep,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: onboardingKeys.progress(role, flowKeyToken),
      })
    },
  })

  // No cache invalidation: event ingestion is telemetry transport; progress is refreshed by step mutations above.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  const ingestEvents = useMutation({
    mutationFn: onboardingApi.ingestEvents,
  })

  const eventTransport = useCallback(
    async (events) => {
      if (!enabled || events.length === 0) {
        return
      }
      const result = await ingestEvents.mutateAsync(events)
      if (result?.updated?.length) {
        await queryClient.invalidateQueries({
          queryKey: onboardingKeys.progress(role, flowKeyToken),
        })
      }
    },
    [enabled, flowKeyToken, ingestEvents, queryClient, role]
  )

  useEffect(() => {
    configureOnboardingEventTransport(eventTransport)
    setOnboardingEventEnabled(enabled && flows.length > 0)
    return () => {
      setOnboardingEventEnabled(false)
      configureOnboardingEventTransport(null)
    }
  }, [enabled, eventTransport, flows.length])

  const lastRouteRef = useRef(null)
  useEffect(() => {
    if (!enabled || flows.length === 0) {
      return
    }
    if (lastRouteRef.current === location.pathname) {
      return
    }
    lastRouteRef.current = location.pathname
    emitOnboardingEvent('nav.route_viewed', { route: location.pathname })
  }, [enabled, flows.length, location.pathname])

  const inProgressSnapshot = useMemo(() => {
    return progressList.find((snapshot) => snapshot.status === 'in_progress') || null
  }, [progressList])

  const nextAutoStartFlow = useMemo(() => {
    if (inProgressSnapshot) {
      return null
    }
    return (
      flows.find((flow) => {
        const snapshot = progressByKey[flow.flow_key]
        if (!snapshot || snapshot.status !== 'not_started') {
          return false
        }
        return canAutoStartFlow(flow, progressByKey)
      }) || null
    )
  }, [flows, inProgressSnapshot, progressByKey])

  const autoStartedRef = useRef(new Set())
  useEffect(() => {
    if (!enabled || !nextAutoStartFlow || startProgress.isPending) {
      return
    }
    const token = `${user.id}:${nextAutoStartFlow.flow_key}:${nextAutoStartFlow.version}`
    if (autoStartedRef.current.has(token)) {
      return
    }
    autoStartedRef.current.add(token)
    startProgress.mutate(
      {
        flow_key: nextAutoStartFlow.flow_key,
        flow_version: nextAutoStartFlow.version,
      },
      {
        onError: () => {
          autoStartedRef.current.delete(token)
        },
      }
    )
  }, [enabled, nextAutoStartFlow, startProgress, user?.id])

  const activeFlow = useMemo(() => {
    if (!inProgressSnapshot) {
      return null
    }
    return (
      flows.find(
        (flow) =>
          flow.flow_key === inProgressSnapshot.flow_key &&
          flow.version === inProgressSnapshot.flow_version
      ) || null
    )
  }, [flows, inProgressSnapshot])

  const stepList = useMemo(() => normalizeSteps(activeFlow), [activeFlow])
  const currentStep = useMemo(() => {
    if (!inProgressSnapshot || !activeFlow) {
      return null
    }
    const step = stepList[inProgressSnapshot.current_step_index]
    return step ? mergeStepMeta(step) : null
  }, [activeFlow, inProgressSnapshot, stepList])

  const flowMeta = useMemo(() => {
    if (!activeFlow) {
      return null
    }
    const flowCopy = FLOW_COPY[activeFlow.flow_key] || {}
    return {
      title:
        activeFlow.definition?.title || flowCopy.title || activeFlow.flow_key.replace(/_/g, ' '),
      description: activeFlow.definition?.description || flowCopy.description || '',
    }
  }, [activeFlow])

  const completedCount = useMemo(() => {
    if (!inProgressSnapshot) {
      return 0
    }
    return (
      (inProgressSnapshot.completed_step_ids?.length || 0) +
      (inProgressSnapshot.skipped_step_ids?.length || 0)
    )
  }, [inProgressSnapshot])

  const totalSteps = stepList.length
  const progressPercent = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0
  const currentStepNumber = inProgressSnapshot
    ? Math.min(inProgressSnapshot.current_step_index + 1, Math.max(totalSteps, 1))
    : 0

  const openCurrentStep = useCallback(() => {
    const route = currentStep?.action?.route
    if (route) {
      navigate(route)
    }
  }, [currentStep, navigate])

  const skipCurrentStep = useCallback(async () => {
    if (!activeFlow || !currentStep?.id) {
      return
    }
    await skipStep.mutateAsync({
      flow_key: activeFlow.flow_key,
      flow_version: activeFlow.version,
      step_id: currentStep.id,
      reason: 'user_skipped',
    })
  }, [activeFlow, currentStep?.id, skipStep])

  return {
    enabled,
    isLoading: flowsQuery.isLoading || progressQuery.isLoading,
    shouldRender: Boolean(enabled && activeFlow && currentStep),
    flowTitle: flowMeta?.title || '',
    flowDescription: flowMeta?.description || '',
    currentStep,
    completedCount,
    totalSteps,
    currentStepNumber,
    progressPercent,
    isMutating: startProgress.isPending || skipStep.isPending,
    openCurrentStep,
    skipCurrentStep,
  }
}
