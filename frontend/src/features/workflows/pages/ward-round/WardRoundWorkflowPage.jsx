import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/layout/layout';
import { PageBreadcrumb } from '@/components/layout/PageBreadcrumb';
import { WorkflowWizard, WorkflowProgress } from '@/components/workflow';
import { WorkflowStepRenderer } from '@/components/workflow';
import { useWardRoundWorkflow } from '@/hooks/useWorkflowQueries';
import { usePatient } from '@/features/patients/hooks/usePatientQueries';
import { PatientIdentityHero } from '@/components/chronicle';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

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
  const [workflowData, setWorkflowData] = useState(null);

  const { data: patient, isLoading: patientLoading } = usePatient(patientId);
  const { startWardRound, updateWardRoundStep, completeWardRound } = useWardRoundWorkflow();

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

  // Initialize workflow on mount
  useEffect(() => {
    if (!workflowId && patientId && admissionId) {
      handleStartWorkflow();
    }
  }, [patientId, admissionId, workflowId]);

  const handleStartWorkflow = async () => {
    try {
      const result = await startWardRound.mutateAsync({
        patientId,
        admissionId,
        initialData: {},
      });
      setWorkflowData(result);
      toast.success('Ward round started');
    } catch (error) {
      toast.error('Failed to start ward round');
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

  const breadcrumbItems = [
    { label: 'Patients', href: '/patients' },
    { label: patient?.full_name || 'Loading...', href: `/patients/${patientId}` },
    { label: 'Ward Round', href: '#' },
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
              Patient ID and Admission ID are required to start a ward round.
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
                <ArrowLeft className="h-4 w-4 mr-2" />
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
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                disabled={completeWardRound.isPending}
              >
                {completeWardRound.isPending ? 'Completing...' : 'Complete Ward Round'}
                <CheckCircle className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
