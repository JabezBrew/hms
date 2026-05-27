import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import { WorkflowWizard, WorkflowProgress } from '@/components/workflow';
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

  // Workflow definition (matching backend)
  const workflowDef = {
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
    const currentStepDef = workflowDef.steps[currentStep - 1];
    if (currentStepDef.required && !formData[currentStepDef.name]) {
      setErrors({ [currentStepDef.name]: 'This field is required' });
      return;
    }

    try {
      await updateWardRoundStep.mutateAsync({
        workflowId: workflowData.workflow.id,
        stepData: formData,
      });

      if (currentStep < workflowDef.total_steps) {
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
    title: 'Ward Round Workflow | HMS',
    breadcrumbs,
  });

  if (moduleGate.isResolving) {
    return (
      <Layout>
        <PageShell>
          {pageMeta}
          <PageHeader
            title="Ward Round Workflow"
            description="Guided daily rounds and patient updates."
          />
          <PageState variant="loading" fullHeight={false} />
        </PageShell>
      </Layout>
    );
  }

  if (!moduleGate.hasFeatureMap) {
    return (
      <Layout>
        <PageShell>
          {pageMeta}
          <PageHeader
            title="Ward Round Workflow"
            description="Guided daily rounds and patient updates."
          />
          <PageState
            variant="error"
            title="Feature capabilities unavailable"
            description={moduleGate.error?.message || 'Module entitlements could not be loaded.'}
            action={() => moduleGate.refetch()}
            fullHeight={false}
          />
        </PageShell>
      </Layout>
    );
  }

  if (!workflowEnabled) {
    return (
      <Layout>
        <PageShell>
          {pageMeta}
          <PageHeader
            title="Ward Round Workflow"
            description="Guided daily rounds and patient updates."
          />
          <PageState
            variant="empty"
            title="Ward round disabled"
            description="Wards and patient chronicle must both be enabled to launch ward rounds."
            fullHeight={false}
          />
        </PageShell>
      </Layout>
    );
  }

  if (!patientId || !admissionId) {
    return (
      <Layout>
        <PageShell>
          {pageMeta}
          <PageHeader
            title="Ward Round Workflow"
            description="Guided daily rounds and patient updates."
          />
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
        </PageShell>
      </Layout>
    );
  }

  if (patientLoading) {
    return (
      <Layout>
        <PageShell>
          {pageMeta}
          <PageHeader
            title="Ward Round Workflow"
            description="Guided daily rounds and patient updates."
          />
          <PageState variant="loading" fullHeight={false} />
        </PageShell>
      </Layout>
    );
  }

  const currentStepDef = workflowDef.steps[currentStep - 1];
  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === workflowDef.total_steps;

  return (
    <Layout>
      <PageShell>
        {pageMeta}
        <PageHeader
          title="Ward Round Workflow"
          description="Guided daily rounds and patient updates."
        />

        <div className="p-4 sm:p-6 space-y-6">
        {/* Patient Identity Header */}
        {patient && (
          <PatientIdentityHero
            patient={patient}
            hideActions={true}
          />
        )}

        {/* Workflow Progress */}
        <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
          <h2 className="font-heading text-lg font-semibold mb-4">Ward Round Progress</h2>
          <WorkflowProgress
            steps={workflowDef.steps.map((s) => ({
              id: s.step_number,
              title: s.title,
            }))}
            currentStep={currentStep}
          />
        </div>

        {/* Current Step */}
        <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
          <div className="mb-6">
            <h2 className="font-display text-2xl font-semibold text-foreground">
              {currentStepDef.title}
            </h2>
            <p className="text-muted-foreground mt-1">{currentStepDef.description}</p>
          </div>

          {/* Step Content - Using WorkflowStepRenderer */}
          <WorkflowStepRenderer
            stepDefinition={currentStepDef}
            values={formData}
            onChange={handleStepDataChange}
            contextData={workflowData?.context_data || {}}
            errors={errors}
          />
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <div>
            <Button variant="outline" onClick={handleCancel} disabled={startWardRound.isPending || updateWardRoundStep.isPending || completeWardRound.isPending}>
              Cancel
            </Button>
          </div>

          <div className="flex items-center gap-3">
            {/* Previous Button */}
            {!isFirstStep && (
              <Button
                variant="outline"
                onClick={handlePrevious}
                disabled={startWardRound.isPending || updateWardRoundStep.isPending || completeWardRound.isPending}
              >
                <ArrowLeft className="size-4 mr-2" />
                Previous
              </Button>
            )}

            {/* Next/Complete Button */}
            {!isLastStep ? (
              <Button
                onClick={handleNext}
                disabled={startWardRound.isPending || updateWardRoundStep.isPending}
              >
                {updateWardRoundStep.isPending ? 'Saving...' : 'Continue'}
                <ArrowRight className="size-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                disabled={completeWardRound.isPending}
              >
                {completeWardRound.isPending ? 'Completing...' : 'Complete Ward Round'}
                <CheckCircle className="size-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
        </div>
      </PageShell>
    </Layout>
  );
}
