import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import React, { useState, useEffect } from 'react';
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

export default function DischargeWorkflowPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const patientId = searchParams.get('patient');
  const admissionId = searchParams.get('admission');
  const workflowId = searchParams.get('workflow');

  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [workflowData, setWorkflowData] = useState(null);
  const moduleGate = useDashboardModuleGates();
  const workflowEnabled = moduleGate.dischargeWorkflowsEnabled && moduleGate.patientChronicleEnabled;

  const { data: patient, isLoading: patientLoading } = usePatient(patientId, {
    enabled: workflowEnabled,
  });
  const { startDischarge, updateDischargeStep, completeDischarge } = useDischargeWorkflow();

  const workflowDef = {
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

  useEffect(() => {
    if (workflowEnabled && !workflowId && patientId && admissionId) {
      handleStartWorkflow();
    }
  }, [patientId, admissionId, workflowId, workflowEnabled]);

  const handleStartWorkflow = async () => {
    try {
      const result = await startDischarge.mutateAsync({
        patientId,
        admissionId,
        initialData: {},
      });
      setWorkflowData(result);
      toast.success('Medical discharge started');
    } catch (error) {
      toast.error('Failed to start medical discharge');
      console.error(error);
    }
  };

  const handleStepDataChange = (data) => {
    setFormData((prev) => ({ ...prev, ...data }));
    setErrors({});
  };

  const handleNext = async () => {
    if (!workflowData?.workflow?.id) {
      toast.error('Workflow not initialized');
      return;
    }

    try {
      await updateDischargeStep.mutateAsync({
        workflowId: workflowData.workflow.id,
        stepData: formData,
      });

      if (currentStep < workflowDef.total_steps) {
        setCurrentStep(currentStep + 1);
        toast.success('Progress saved');
      }
    } catch (error) {
      toast.error('Failed to save progress');
      console.error(error);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
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
    } catch (error) {
      toast.error('Failed to submit medical discharge');
      console.error(error);
    }
  };

  const handleCancel = () => {
    if (window.confirm('Are you sure you want to cancel this discharge?')) {
      navigate(`/patients/${patientId}`);
    }
  };

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
      <Layout>
        <PageShell>
          {pageMeta}
          <PageHeader
            title="Medical Discharge Workflow"
            description="Guided steps to submit a medical discharge for operational clearance."
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
            title="Medical Discharge Workflow"
            description="Guided steps to submit a medical discharge for operational clearance."
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
            title="Medical Discharge Workflow"
            description="Guided steps to submit a medical discharge for operational clearance."
          />
          <PageState
            variant="empty"
            title="Medical discharge disabled"
            description="Discharge workflows and patient chronicle must both be enabled to launch medical discharge."
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
            title="Medical Discharge Workflow"
            description="Guided steps to submit a medical discharge for operational clearance."
          />
          <PageState
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
            title="Medical Discharge Workflow"
            description="Guided steps to submit a medical discharge for operational clearance."
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
          title="Medical Discharge Workflow"
          description="Guided steps to submit a medical discharge for operational clearance."
        />

        <div className="p-4 sm:p-6 space-y-6">
        {patient && <PatientIdentityHero patient={patient} hideActions={true} />}

        <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
          <h2 className="font-heading text-lg font-semibold mb-4">Medical Discharge Progress</h2>
          <WorkflowProgress
            steps={workflowDef.steps.map((s) => ({
              id: s.step_number,
              title: s.title,
            }))}
            currentStep={currentStep}
          />
        </div>

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
            onChange={handleStepDataChange}
            contextData={workflowData?.context_data || {}}
            errors={errors}
          />
        </div>

        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={handleCancel} disabled={startDischarge.isPending || updateDischargeStep.isPending || completeDischarge.isPending}>
            Cancel
          </Button>

          <div className="flex items-center gap-3">
            {!isFirstStep && (
              <Button
                variant="outline"
                onClick={handlePrevious}
                disabled={startDischarge.isPending || updateDischargeStep.isPending || completeDischarge.isPending}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Previous
              </Button>
            )}

            {!isLastStep ? (
              <Button
                onClick={handleNext}
                disabled={startDischarge.isPending || updateDischargeStep.isPending}
              >
                {updateDischargeStep.isPending ? 'Saving...' : 'Continue'}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                disabled={completeDischarge.isPending}
              >
                {completeDischarge.isPending ? 'Submitting...' : 'Submit for Clearance'}
                <CheckCircle className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
        </div>
      </PageShell>
    </Layout>
  );
}
