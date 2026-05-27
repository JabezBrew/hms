import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import { WorkflowProgress, WorkflowStepRenderer } from '@/components/workflow';
import { useDischargeWorkflow } from '@/features/workflows/hooks';
import { usePatient } from '@/features/patients/hooks/usePatientQueries';
import { useDashboardModuleGates } from '@/features/dashboards/hooks';
import { PatientIdentityHero } from '@/components/chronicle';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

import { toast } from 'sonner';

const PAGE_TITLE = 'Medical Discharge Workflow';
const PAGE_DESCRIPTION = 'Guided steps to submit a medical discharge for operational clearance.';

const DISCHARGE_WORKFLOW_DEF = {
  name: 'Medical Discharge',
  total_steps: 4,
  steps: [
    {
      step_number: 1,
      name: 'discharge_planning',
      title: 'Medical Discharge Planning',
      description: 'Review discharge readiness and effective timing',
    },
    {
      step_number: 2,
      name: 'medications',
      title: 'Discharge Medications',
      description: 'Reconcile and prescribe discharge medications',
    },
    {
      step_number: 3,
      name: 'instructions',
      title: 'Discharge Instructions',
      description: 'Provide patient education and follow-up plans',
    },
    {
      step_number: 4,
      name: 'summary',
      title: 'Submit for Clearance',
      description: 'Complete the discharge summary and submit for billing and nursing clearance',
    },
  ],
};

function DischargeWorkflowFrame({ pageMeta, children }) {
  return (
    <Layout>
      <PageShell>
        {pageMeta}
        <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        {children}
      </PageShell>
    </Layout>
  );
}

function DischargePageState({ pageMeta, ...stateProps }) {
  return (
    <DischargeWorkflowFrame pageMeta={pageMeta}>
      <PageState {...stateProps} fullHeight={false} />
    </DischargeWorkflowFrame>
  );
}

function DischargeProgressPanel({ currentStep }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <h2 className="font-heading text-lg font-semibold mb-4">Medical Discharge Progress</h2>
      <WorkflowProgress
        steps={DISCHARGE_WORKFLOW_DEF.steps.map((step) => ({
          id: step.step_number,
          title: step.title,
        }))}
        currentStep={currentStep}
      />
    </div>
  );
}

function DischargeStepPanel({ stepDefinition, values, onChange, contextData, errors }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold text-foreground">
          {stepDefinition.title}
        </h2>
        <p className="text-muted-foreground mt-1">{stepDefinition.description}</p>
      </div>

      <WorkflowStepRenderer
        stepDefinition={stepDefinition}
        values={values}
        onChange={onChange}
        contextData={contextData}
        errors={errors}
      />
    </div>
  );
}

function DischargeNavigation({ status, actions }) {
  return (
    <div className="flex items-center justify-between">
      <Button
        variant="outline"
        onClick={actions.onCancel}
        disabled={status.isBusy}
      >
        Cancel
      </Button>

      <div className="flex items-center gap-3">
        {!status.isFirstStep && (
          <Button
            variant="outline"
            onClick={actions.onPrevious}
            disabled={status.isBusy}
          >
            <ArrowLeft className="size-4 mr-2" />
            Previous
          </Button>
        )}

        {!status.isLastStep ? (
          <Button
            onClick={actions.onNext}
            disabled={status.isStarting || status.isSaving}
          >
            {status.isSaving ? 'Saving...' : 'Continue'}
            <ArrowRight className="size-4 ml-2" />
          </Button>
        ) : (
          <Button
            onClick={actions.onComplete}
            disabled={status.isSubmitting}
          >
            {status.isSubmitting ? 'Submitting...' : 'Submit for Clearance'}
            <CheckCircle className="size-4 ml-2" />
          </Button>
        )}
      </div>
    </div>
  );
}

function DischargeWorkflowBody({
  pageMeta,
  patient,
  currentStep,
  stepDefinition,
  formData,
  errors,
  contextData,
  status,
  actions,
}) {
  return (
    <DischargeWorkflowFrame pageMeta={pageMeta}>
      <div className="p-4 sm:p-6 space-y-6">
        {patient && <PatientIdentityHero patient={patient} hideActions={true} />}

        <DischargeProgressPanel currentStep={currentStep} />

        <DischargeStepPanel
          stepDefinition={stepDefinition}
          values={formData}
          onChange={actions.onStepDataChange}
          contextData={contextData}
          errors={errors}
        />

        <DischargeNavigation status={status} actions={actions} />
      </div>
    </DischargeWorkflowFrame>
  );
}

export default function DischargeWorkflowPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const patientId = searchParams.get('patient');
  const admissionId = searchParams.get('admission');
  const workflowId = searchParams.get('workflow');

  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const moduleGate = useDashboardModuleGates();
  const workflowEnabled = moduleGate.dischargeWorkflowsEnabled && moduleGate.patientChronicleEnabled;

  const { data: patient, isLoading: patientLoading } = usePatient(patientId, {
    enabled: workflowEnabled,
  });
  const { startDischarge, updateDischargeStep, completeDischarge } = useDischargeWorkflow();
  const workflowData = startDischarge.data;

  const handleStartWorkflow = useCallback(async () => {
    try {
      await startDischarge.mutateAsync({
        patientId,
        admissionId,
        initialData: {},
      });
      toast.success('Medical discharge started');
    } catch {
      toast.error('Failed to start medical discharge');
    }
  }, [admissionId, patientId, startDischarge]);

  const activeWorkflowId = workflowId || workflowData?.workflow?.id;

  useEffect(() => {
    if (workflowEnabled && !activeWorkflowId && !startDischarge.isPending && patientId && admissionId) {
      handleStartWorkflow();
    }
  }, [
    activeWorkflowId,
    admissionId,
    handleStartWorkflow,
    patientId,
    startDischarge.isPending,
    workflowEnabled,
  ]);

  const handleStepDataChange = useCallback((data) => {
    setFormData((prev) => ({ ...prev, ...data }));
    setErrors({});
  }, []);

  const handleNext = useCallback(async () => {
    if (!workflowData?.workflow?.id) {
      toast.error('Workflow not initialized');
      return;
    }

    try {
      await updateDischargeStep.mutateAsync({
        workflowId: workflowData.workflow.id,
        stepData: formData,
      });

      if (currentStep < DISCHARGE_WORKFLOW_DEF.total_steps) {
        setCurrentStep((step) => step + 1);
        toast.success('Progress saved');
      }
    } catch {
      toast.error('Failed to save progress');
    }
  }, [currentStep, formData, updateDischargeStep, workflowData?.workflow?.id]);

  const handlePrevious = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep((step) => step - 1);
    }
  }, [currentStep]);

  const handleComplete = useCallback(async () => {
    if (!workflowData?.workflow?.id) {
      toast.error('Workflow not initialized');
      return;
    }

    try {
      await completeDischarge.mutateAsync({
        workflowId: workflowData.workflow.id,
        finalData: formData,
      });
      toast.success('Medical discharge submitted for clearance');
      navigate(`/patients/${patientId}`);
    } catch {
      toast.error('Failed to submit medical discharge');
    }
  }, [completeDischarge, formData, navigate, patientId, workflowData?.workflow?.id]);

  const handleCancel = useCallback(() => {
    if (window.confirm('Are you sure you want to cancel this discharge?')) {
      navigate(`/patients/${patientId}`);
    }
  }, [navigate, patientId]);

  const breadcrumbs = [
    { label: 'Patients', href: '/patients' },
    ...(patientId
      ? [{ label: patient?.full_name || 'Patient', href: `/patients/${patientId}` }]
      : []),
    { label: 'Medical Discharge' },
  ];

  const pageMeta = usePageMeta({
    title: 'Medical Discharge Workflow | HMS',
    breadcrumbs,
  });

  if (moduleGate.isResolving) {
    return (
      <DischargePageState pageMeta={pageMeta} variant="loading" />
    );
  }

  if (!moduleGate.hasFeatureMap) {
    return (
      <DischargePageState
        pageMeta={pageMeta}
        variant="error"
        title="Feature capabilities unavailable"
        description={moduleGate.error?.message || 'Module entitlements could not be loaded.'}
        action={() => moduleGate.refetch()}
      />
    );
  }

  if (!workflowEnabled) {
    return (
      <DischargePageState
        pageMeta={pageMeta}
        variant="empty"
        title="Medical discharge disabled"
        description="Discharge workflows and patient chronicle must both be enabled to launch medical discharge."
      />
    );
  }

  if (!patientId || !admissionId) {
    return (
      <DischargePageState
        pageMeta={pageMeta}
        variant="error"
        title="Missing parameters"
        description="Patient ID and Admission ID are required to start a medical discharge."
        action={(
          <Button
            variant="outline"
            onClick={() => navigate('/dashboards/inpatient')}
          >
            Back to Dashboard
          </Button>
        )}
      />
    );
  }

  if (patientLoading) {
    return (
      <DischargePageState pageMeta={pageMeta} variant="loading" />
    );
  }

  const currentStepDef = DISCHARGE_WORKFLOW_DEF.steps[currentStep - 1];
  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === DISCHARGE_WORKFLOW_DEF.total_steps;
  const status = {
    isFirstStep,
    isLastStep,
    isStarting: startDischarge.isPending,
    isSaving: updateDischargeStep.isPending,
    isSubmitting: completeDischarge.isPending,
    isBusy: startDischarge.isPending || updateDischargeStep.isPending || completeDischarge.isPending,
  };
  const actions = {
    onCancel: handleCancel,
    onPrevious: handlePrevious,
    onNext: handleNext,
    onComplete: handleComplete,
    onStepDataChange: handleStepDataChange,
  };

  return (
    <DischargeWorkflowBody
      pageMeta={pageMeta}
      patient={patient}
      currentStep={currentStep}
      stepDefinition={currentStepDef}
      formData={formData}
      errors={errors}
      contextData={workflowData?.context_data || {}}
      status={status}
      actions={actions}
    />
  );
}
