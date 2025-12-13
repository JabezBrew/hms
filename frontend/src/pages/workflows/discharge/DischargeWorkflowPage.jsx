import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import { PageBreadcrumb } from '@/components/layout/PageBreadcrumb';
import { WorkflowProgress, WorkflowStepRenderer } from '@/components/workflow';
import { useDischargeWorkflow } from '@/hooks/useWorkflowQueries';
import { usePatient } from '@/hooks/usePatientQueries';
import { PatientIdentityHero } from '@/components/chronicle';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle } from 'lucide-react';
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

  const { data: patient, isLoading: patientLoading } = usePatient(patientId);
  const { startDischarge, updateDischargeStep, completeDischarge } = useDischargeWorkflow();

  const workflowDef = {
    name: 'Patient Discharge',
    total_steps: 4,
    steps: [
      {
        step_number: 1,
        name: 'discharge_planning',
        title: 'Discharge Planning',
        description: 'Review discharge readiness and plan',
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
        title: 'Discharge Summary',
        description: 'Complete discharge summary and finalize',
      },
    ],
  };

  useEffect(() => {
    if (!workflowId && patientId && admissionId) {
      handleStartWorkflow();
    }
  }, [patientId, admissionId, workflowId]);

  const handleStartWorkflow = async () => {
    try {
      const result = await startDischarge.mutateAsync({
        patientId,
        admissionId,
        initialData: {},
      });
      setWorkflowData(result);
      toast.success('Discharge workflow started');
    } catch (error) {
      toast.error('Failed to start discharge');
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
      toast.success('Discharge completed successfully');
      navigate(`/patients/${patientId}`);
    } catch (error) {
      toast.error('Failed to complete discharge');
      console.error(error);
    }
  };

  const handleCancel = () => {
    if (window.confirm('Are you sure you want to cancel this discharge?')) {
      navigate(`/patients/${patientId}`);
    }
  };

  const breadcrumbItems = [
    { label: 'Patients', href: '/patients' },
    { label: patient?.full_name || 'Loading...', href: `/patients/${patientId}` },
    { label: 'Discharge', href: '#' },
  ];

  if (!patientId || !admissionId) {
    return (
      <Layout>
        <div className="p-6">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6">
            <AlertTriangle className="h-6 w-6 text-rose-400 mb-2" />
            <h3 className="font-heading text-lg font-semibold text-rose-400 mb-1">
              Missing Parameters
            </h3>
            <p className="text-sm text-muted-foreground">
              Patient ID and Admission ID are required to start a discharge.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => navigate('/dashboards/inpatient')}
            >
              Back to Dashboard
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  if (patientLoading) {
    return (
      <Layout>
        <div className="p-6 space-y-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </Layout>
    );
  }

  const currentStepDef = workflowDef.steps[currentStep - 1];
  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === workflowDef.total_steps;

  return (
    <Layout>
      <PageBreadcrumb items={breadcrumbItems} />

      <div className="p-4 sm:p-6 space-y-6">
        {patient && <PatientIdentityHero patient={patient} hideActions={true} />}

        <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
          <h2 className="font-heading text-lg font-semibold mb-4">Discharge Progress</h2>
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
                {completeDischarge.isPending ? 'Completing...' : 'Complete Discharge'}
                <CheckCircle className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
