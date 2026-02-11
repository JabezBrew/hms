import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
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

const FLOW_COPY = {
  doctor_core_v1: {
    title: 'Doctor Essentials',
    description: 'Complete the core actions used in daily charting.',
  },
  doctor_templates_v1: {
    title: 'Template Quickstart',
    description: 'Create and apply note/chart templates for faster documentation.',
  },
}

const STEP_COPY = {
  core_01_start: {
    title: 'Open your dashboard',
    description: 'Begin from the inpatient dashboard.',
    action: { label: 'Open Dashboard', route: '/dashboards/inpatient' },
  },
  core_02_open_registry: {
    title: 'Open patient registry',
    description: 'Go to the patient registry or your assigned patient list.',
    action: { label: 'Open Patients', route: '/patients' },
  },
  core_03_open_patient_chart: {
    title: 'Open a patient chart',
    description: 'Select any patient and load the chronicle.',
    action: { label: 'Open Patients', route: '/patients' },
  },
  core_04_timeline_filters: {
    title: 'Use timeline filters',
    description: 'Switch to Notes, then back to All for one patient.',
    action: { label: 'Return To Chart', route: '/patients' },
  },
  core_05_create_note: {
    title: 'Create a clinical note',
    description: 'Add a note from the patient chronicle.',
    action: { label: 'Open Patients', route: '/patients' },
  },
  core_06_place_order: {
    title: 'Place an order',
    description: 'Create a prescription or submit a lab order.',
    action: { label: 'Open Patients', route: '/patients' },
  },
  tpl_01_open_note_templates: {
    title: 'Open note templates',
    description: 'Go to clinical note templates.',
    action: { label: 'Open Note Templates', route: '/clinical-notes/templates' },
  },
  tpl_02_create_note_template: {
    title: 'Create a note template',
    description: 'Build a note template with at least 3 sections.',
    action: { label: 'Create Note Template', route: '/clinical-notes/templates' },
  },
  tpl_03_use_note_template: {
    title: 'Use your note template',
    description: 'Create a note using the template you just created.',
    action: { label: 'Open Patients', route: '/patients' },
  },
  tpl_04_open_chart_templates: {
    title: 'Open chart templates',
    description: 'Go to chart templates.',
    action: { label: 'Open Chart Templates', route: '/charts/templates' },
  },
  tpl_05_create_chart_template: {
    title: 'Create a chart template',
    description: 'Create a chart template you can assign to a patient.',
    action: { label: 'Create Chart Template', route: '/charts/builder' },
  },
  tpl_06_use_chart_template: {
    title: 'Use your chart template',
    description: 'Assign the template and record one chart entry.',
    action: { label: 'Open Patients', route: '/patients' },
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
  return Array.isArray(steps) ? steps : []
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
  const action = {
    label: stepAction.label || fallbackAction.label || 'Open Step',
    route: stepAction.route || fallbackAction.route || null,
  }

  return {
    id: step?.id || null,
    title: step?.title || fallback.title || 'Next Step',
    description: step?.description || fallback.description || '',
    action,
  }
}

export function useOnboardingRuntime() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
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
  const refetchProgress = progressQuery.refetch

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
      void refetchProgress()
    },
  })

  const skipStep = useMutation({
    mutationFn: onboardingApi.skipStep,
    onSuccess: () => {
      void refetchProgress()
    },
  })

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
        await refetchProgress()
      }
    },
    [enabled, ingestEvents, refetchProgress]
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
    progressPercent,
    isMutating: startProgress.isPending || skipStep.isPending,
    openCurrentStep,
    skipCurrentStep,
  }
}
