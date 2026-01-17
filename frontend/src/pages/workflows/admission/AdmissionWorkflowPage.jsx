import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import { PageBreadcrumb } from '@/components/layout/PageBreadcrumb';
import { WorkflowProgress, WorkflowStepRenderer } from '@/components/workflow';
import { useAdmissionWorkflow } from '@/hooks/useWorkflowQueries';
import { usePatient } from '@/hooks/usePatientQueries';
import { PatientIdentityHero } from '@/components/chronicle';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { toast } from 'sonner';

export default function AdmissionWorkflowPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const patientId = searchParams.get('patient');
  const workflowId = searchParams.get('workflow');

  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [workflowData, setWorkflowData] = useState(null);

  const { data: patient, isLoading: patientLoading } = usePatient(patientId);
  const { startAdmission, updateAdmissionStep, completeAdmission } = useAdmissionWorkflow();

  const workflowDef = {
    name: 'Patient Admission',
    total_steps: 5,
    steps: [
      {
        step_number: 1,
        name: 'patient_info',
        title: 'Patient Information',
        description: 'Verify patient identity and emergency contacts',
      },
      {
        step_number: 2,
        name: 'bed_assignment',
        title: 'Bed Assignment',
        description: 'Assign ward and bed',
      },
      {
        step_number: 3,
        name: 'clinical_info',
        title: 'Clinical Information',
        description: 'Record admission reason and initial assessment',
      },
      {
        step_number: 4,
        name: 'orders',
        title: 'Admission Orders',
        description: 'Create initial orders and care plan',
      },
      {
        step_number: 5,
        name: 'documentation',
        title: 'Complete Admission',
        description: 'Review and finalize admission',
      },
    ],
  };

  useEffect(() => {
    if (!workflowId && patientId) {
      handleStartWorkflow();
    }
  }, [patientId, workflowId]);

  const handleStartWorkflow = async () => {
    try {
      const result = await startAdmission.mutateAsync({
        patientId,
        initialData: {},
      });
      setWorkflowData(result);
      toast.success('Admission workflow started');
    } catch (error) {
      toast.error('Failed to start admission');
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
      await updateAdmissionStep.mutateAsync({
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
      await completeAdmission.mutateAsync({
        workflowId: workflowData.workflow.id,
        finalData: formData,
      });
      toast.success('Admission completed successfully');
      navigate(`/patients/${patientId}`);
    } catch (error) {
      toast.error('Failed to complete admission');
      console.error(error);
    }
  };

  const handleCancel = () => {
    if (window.confirm('Are you sure you want to cancel this admission?')) {
      navigate(`/patients/${patientId}`);
    }
  };

  const breadcrumbItems = [
    { label: 'Patients', href: '/patients' },
    { label: patient?.full_name || 'Loading...', href: `/patients/${patientId}` },
    { label: 'Admission', href: '#' },
  ];

  if (!patientId) {
    return (
      <Layout>
        <div className="p-6">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6">
            <AlertTriangle className="h-6 w-6 text-rose-400 mb-2" />
            <h3 className="font-heading text-lg font-semibold text-rose-400 mb-1">
              Missing Patient ID
            </h3>
            <p className="text-sm text-muted-foreground">
              Patient ID is required to start an admission.
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
          <h2 className="font-heading text-lg font-semibold mb-4">Admission Progress</h2>
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
          <Button variant="outline" onClick={handleCancel} disabled={startAdmission.isPending || updateAdmissionStep.isPending || completeAdmission.isPending}>
            Cancel
          </Button>

          <div className="flex items-center gap-3">
            {!isFirstStep && (
              <Button
                variant="outline"
                onClick={handlePrevious}
                disabled={startAdmission.isPending || updateAdmissionStep.isPending || completeAdmission.isPending}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Previous
              </Button>
            )}

            {!isLastStep ? (
              <Button
                onClick={handleNext}
                disabled={startAdmission.isPending || updateAdmissionStep.isPending}
              >
                {updateAdmissionStep.isPending ? 'Saving...' : 'Continue'}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                disabled={completeAdmission.isPending}
              >
                {completeAdmission.isPending ? 'Completing...' : 'Complete Admission'}
                <CheckCircle className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
