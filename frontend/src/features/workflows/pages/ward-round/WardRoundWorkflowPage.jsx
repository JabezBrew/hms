import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import { WorkflowProgress } from '@/components/workflow';
import { WorkflowStepRenderer } from '@/components/workflow';
import { useWardRoundWorkflow } from '@/features/workflows/hooks';
import { usePatient } from '@/features/patients/hooks/usePatientQueries';
import { useDashboardModuleGates } from '@/features/dashboards/hooks';
import { PatientIdentityHero } from '@/components/chronicle';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

import { toast } from 'sonner';

const PAGE_TITLE = 'Ward Round Workflow';
const PAGE_DESCRIPTION = 'Guided daily rounds and patient updates.';

const WARD_ROUND_WORKFLOW_DEF = {
  name: 'Ward Round',
  total_steps: 4,
  steps: [
    {
      step_number: 1,
      name: 'patient_review',
      title: 'Patient Review',
      description: 'Review patient status and overnight events',
    },
    {
      step_number: 2,
      name: 'clinical_assessment',
      title: 'Clinical Assessment',
      description: 'Examine patient and review vitals',
    },
    {
      step_number: 3,
      name: 'plan',
      title: 'Treatment Plan',
      description: 'Update treatment plan and orders',
    },
    {
      step_number: 4,
      name: 'documentation',
      title: 'Documentation',
      description: 'Complete ward round documentation',
    },
  ],
};

/**
 * Ward Round Workflow Page
 * Guided 4-step workflow for daily patient rounds
 */
export default function WardRoundWorkflowPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const patientId = searchParams.get('patient');
  const admissionId = searchParams.get('admission');
  const workflowId = searchParams.get('workflow');

  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const moduleGate = useDashboardModuleGates();
  const workflowEnabled = moduleGate.wardsEnabled && moduleGate.patientChronicleEnabled;

  const { data: patient, isLoading: patientLoading } = usePatient(patientId, {
    enabled: workflowEnabled,
  });
  const { startWardRound, updateWardRoundStep, completeWardRound } = useWardRoundWorkflow();
  const workflowData = startWardRound.data;

  const handleStartWorkflow = useCallback(async () => {
    try {
      await startWardRound.mutateAsync({
        patientId,
        admissionId,
        initialData: {},
      });
      toast.success('Ward round started');
    } catch (error) {
      toast.error('Failed to start ward round');
      console.error(error);
    }
  }, [admissionId, patientId, startWardRound]);

  const activeWorkflowId = workflowId || workflowData?.workflow?.id;

  // Initialize workflow on mount
  useEffect(() => {
    if (workflowEnabled && !activeWorkflowId && !startWardRound.isPending && patientId && admissionId) {
      handleStartWorkflow();
    }
  }, [
    activeWorkflowId,
    admissionId,
    handleStartWorkflow,
    patientId,
    startWardRound.isPending,
    workflowEnabled,
  ]);

  const handleStepDataChange = (data) => {
    setFormData((prev) => ({ ...prev, ...data }));
    setErrors({});
  };

  const handleNext = async () => {
    if (!workflowData?.workflow?.id) {
      toast.error('Workflow not initialized');
      return;
    }

    // Basic validation
    const currentStepDef = WARD_ROUND_WORKFLOW_DEF.steps[currentStep - 1];
    if (currentStepDef.required && !formData[currentStepDef.name]) {
      setErrors({ [currentStepDef.name]: 'This field is required' });
      return;
    }

    try {
      await updateWardRoundStep.mutateAsync({
        workflowId: workflowData.workflow.id,
        stepData: formData,
      });

      if (currentStep < WARD_ROUND_WORKFLOW_DEF.total_steps) {
        setCurrentStep((step) => step + 1);
        toast.success('Progress saved');
      }
    } catch (error) {
      toast.error('Failed to save progress');
      console.error(error);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep((step) => step - 1);
    }
  };

  const handleComplete = async () => {
    if (!workflowData?.workflow?.id) {
      toast.error('Workflow not initialized');
      return;
    }

    try {
      await completeWardRound.mutateAsync({
        workflowId: workflowData.workflow.id,
        finalData: formData,
      });
      toast.success('Ward round completed successfully');
      navigate(`/patients/${patientId}`);
    } catch (error) {
      toast.error('Failed to complete ward round');
      console.error(error);
    }
  };

  const handleCancel = () => {
    if (window.confirm('Are you sure you want to cancel this ward round?')) {
      navigate(`/patients/${patientId}`);
    }
  };

  const breadcrumbs = [
    { label: 'Patients', href: '/patients' },
    ...(patientId
      ? [{ label: patient?.full_name || 'Patient', href: `/patients/${patientId}` }]
      : []),
    { label: 'Ward Round' },
  ];

  const pageMeta = usePageMeta({
    title: `${PAGE_TITLE} | HMS`,
    breadcrumbs,
  });

  if (moduleGate.isResolving) {
    return (
      <WardRoundPageFrame pageMeta={pageMeta}>
        <PageState variant="loading" fullHeight={false} />
      </WardRoundPageFrame>
    );
  }

  if (!moduleGate.hasFeatureMap) {
    return (
      <WardRoundPageFrame pageMeta={pageMeta}>
        <PageState
          variant="error"
          title="Feature capabilities unavailable"
          description={moduleGate.error?.message || 'Module entitlements could not be loaded.'}
          action={() => moduleGate.refetch()}
          fullHeight={false}
        />
      </WardRoundPageFrame>
    );
  }

  if (!workflowEnabled) {
    return (
      <WardRoundPageFrame pageMeta={pageMeta}>
        <PageState
          variant="empty"
          title="Ward round disabled"
          description="Wards and patient chronicle must both be enabled to launch ward rounds."
          fullHeight={false}
        />
      </WardRoundPageFrame>
    );
  }

  if (!patientId || !admissionId) {
    return (
      <WardRoundPageFrame pageMeta={pageMeta}>
        <PageState
          variant="error"
          title="Missing parameters"
          description="Patient ID and Admission ID are required to start a ward round."
          action={(
            <Button
              variant="outline"
              onClick={() => navigate('/dashboards/inpatient')}
            >
              Back to Dashboard
            </Button>
          )}
          fullHeight={false}
        />
      </WardRoundPageFrame>
    );
  }

  if (patientLoading) {
    return (
      <WardRoundPageFrame pageMeta={pageMeta}>
        <PageState variant="loading" fullHeight={false} />
      </WardRoundPageFrame>
    );
  }

  const currentStepDef = WARD_ROUND_WORKFLOW_DEF.steps[currentStep - 1];
  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === WARD_ROUND_WORKFLOW_DEF.total_steps;

  return (
    <WardRoundPageFrame pageMeta={pageMeta}>
      <WardRoundWorkflowBody
        completePending={completeWardRound.isPending}
        currentStep={currentStep}
        currentStepDef={currentStepDef}
        errors={errors}
        formData={formData}
        isFirstStep={isFirstStep}
        isLastStep={isLastStep}
        onCancel={handleCancel}
        onComplete={handleComplete}
        onNext={handleNext}
        onPrevious={handlePrevious}
        onStepDataChange={handleStepDataChange}
        patient={patient}
        startPending={startWardRound.isPending}
        updatePending={updateWardRoundStep.isPending}
        workflowData={workflowData}
      />
    </WardRoundPageFrame>
  );
}

function WardRoundPageFrame({ children, pageMeta }) {
  return (
    <Layout>
      <PageShell>
        {pageMeta}
        <PageHeader
          title={PAGE_TITLE}
          description={PAGE_DESCRIPTION}
        />
        {children}
      </PageShell>
    </Layout>
  );
}

function WardRoundWorkflowBody({
  completePending,
  currentStep,
  currentStepDef,
  errors,
  formData,
  isFirstStep,
  isLastStep,
  onCancel,
  onComplete,
  onNext,
  onPrevious,
  onStepDataChange,
  patient,
  startPending,
  updatePending,
  workflowData,
}) {
  const isMutating = startPending || updatePending || completePending;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {patient && (
        <PatientIdentityHero
          patient={patient}
          hideActions={true}
        />
      )}

      <WardRoundProgress currentStep={currentStep} />
      <WardRoundCurrentStep
        currentStepDef={currentStepDef}
        errors={errors}
        formData={formData}
        onStepDataChange={onStepDataChange}
        workflowData={workflowData}
      />
      <WardRoundNavigation
        completePending={completePending}
        isFirstStep={isFirstStep}
        isLastStep={isLastStep}
        isMutating={isMutating}
        onCancel={onCancel}
        onComplete={onComplete}
        onNext={onNext}
        onPrevious={onPrevious}
        updatePending={updatePending}
      />
    </div>
  );
}

function WardRoundProgress({ currentStep }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <h2 className="font-heading text-lg font-semibold mb-4">Ward Round Progress</h2>
      <WorkflowProgress
        steps={WARD_ROUND_WORKFLOW_DEF.steps.map((step) => ({
          id: step.step_number,
          title: step.title,
        }))}
        currentStep={currentStep}
      />
    </div>
  );
}

function WardRoundCurrentStep({
  currentStepDef,
  errors,
  formData,
  onStepDataChange,
  workflowData,
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold text-foreground">
          {currentStepDef.title}
        </h2>
        <p className="text-muted-foreground mt-1">{currentStepDef.description}</p>
      </div>

      <WorkflowStepRenderer
        stepDefinition={currentStepDef}
        values={formData}
        onChange={onStepDataChange}
        contextData={workflowData?.context_data || {}}
        errors={errors}
      />
    </div>
  );
}

function WardRoundNavigation({
  completePending,
  isFirstStep,
  isLastStep,
  isMutating,
  onCancel,
  onComplete,
  onNext,
  onPrevious,
  updatePending,
}) {
  return (
    <div className="flex items-center justify-between">
      <Button variant="outline" onClick={onCancel} disabled={isMutating}>
        Cancel
      </Button>

      <div className="flex items-center gap-3">
        {!isFirstStep && (
          <Button
            variant="outline"
            onClick={onPrevious}
            disabled={isMutating}
          >
            <ArrowLeft className="size-4 mr-2" />
            Previous
          </Button>
        )}

        {!isLastStep ? (
          <Button
            onClick={onNext}
            disabled={updatePending}
          >
            {updatePending ? 'Saving...' : 'Continue'}
            <ArrowRight className="size-4 ml-2" />
          </Button>
        ) : (
          <Button
            onClick={onComplete}
            disabled={completePending}
          >
            {completePending ? 'Completing...' : 'Complete Ward Round'}
            <CheckCircle className="size-4 ml-2" />
          </Button>
        )}
      </div>
    </div>
  );
}
