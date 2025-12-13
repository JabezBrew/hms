import { useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { WorkflowWizard } from '@/components/workflow/WorkflowWizard';
import { useWorkflow } from '@/hooks/useWorkflow';
import { CONSULTATION_WORKFLOW, validateStep } from './definition';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

// Step components
import { PrepStep } from './steps/PrepStep';
import { HistoryStep } from './steps/HistoryStep';
import { AssessmentStep } from './steps/AssessmentStep';

const stepComponents = {
  PrepStep,
  HistoryStep,
  AssessmentStep,
};

export function ConsultationWorkflow() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const patientId = searchParams.get('patient_id');
  const appointmentId = searchParams.get('appointment_id');
  const workflowIdParam = searchParams.get('workflow_id');

  const {
    workflow,
    loading,
    error,
    loadWorkflow,
    startWorkflow,
    updateStep,
    completeWorkflow,
    saveDraft,
    cancelWorkflow,
    isStarting,
  } = useWorkflow('consultation');

  // Load existing workflow if workflow_id is provided (e.g., from referral inbox)
  useEffect(() => {
    if (workflowIdParam && !workflow && !loading) {
      loadWorkflow(workflowIdParam);
    }
  }, [workflowIdParam, workflow, loading, loadWorkflow]);

  // Initialize NEW workflow on mount (when patient_id is provided without workflow_id)
  useEffect(() => {
    if (patientId && !workflowIdParam && !workflow && !isStarting) {
      startWorkflow({
        patient_id: patientId,  // Keep as UUID string, don't parse
        appointment_id: appointmentId || undefined,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, appointmentId, workflowIdParam]);

  const handleStepComplete = async (stepData, nextStep) => {
    // Extract consultation-specific fields
    const consultationFields = {};
    ['chief_complaint', 'hpi', 'ros', 'physical_exam', 'assessment', 'plan'].forEach(field => {
      if (stepData[field] !== undefined) {
        consultationFields[field] = stepData[field];
      }
    });

    await updateStep(stepData, nextStep, consultationFields);
  };

  const handleComplete = async (finalData) => {
    try {
      const result = await completeWorkflow({
        final_data: finalData,
        encounter_type: 'outpatient',
        encounter_status: 'finished',
      });

      if (result.success && result.encounter_id) {
        toast.success('Consultation completed successfully');
        navigate(`/encounters/${result.encounter_id}`);
      }
    } catch (error) {
      console.error('Failed to complete consultation:', error);
      throw error;
    }
  };

  const handleCancel = async () => {
    if (confirm('Are you sure you want to cancel this consultation? Unsaved changes will be lost.')) {
      try {
        await cancelWorkflow();
        navigate('/dashboard/doctor');
      } catch (error) {
        console.error('Failed to cancel workflow:', error);
      }
    }
  };

  const handleSaveDraft = async (contextData) => {
    try {
      await saveDraft(contextData);
    } catch (error) {
      console.error('Failed to save draft:', error);
    }
  };

  if (loading || isStarting) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">
            {workflowIdParam ? 'Loading consultation...' : 'Starting consultation...'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <p className="text-destructive">Error loading consultation: {error.message}</p>
        <Button onClick={() => navigate('/dashboard/doctor')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  if (!workflow) {
    // If we have neither patient_id nor workflow_id, show an error
    if (!patientId && !workflowIdParam) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
          <p className="text-destructive">Missing patient or workflow information</p>
          <Button onClick={() => navigate('/dashboard/doctor')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
      );
    }
    // Otherwise, still loading/initializing
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">Preparing consultation...</p>
        </div>
      </div>
    );
  }

  // Add validateStep to definition
  const workflowDefinition = {
    ...CONSULTATION_WORKFLOW,
    validateStep,
  };

  return (
    <div className="container mx-auto py-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-4 mb-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard/doctor')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Clinical Consultation</h1>
            <p className="text-muted-foreground">
              {workflow.patient_name || 'Patient Consultation'}
            </p>
          </div>
        </div>
      </div>

      {/* Workflow Wizard */}
      <WorkflowWizard
        definition={workflowDefinition}
        stepComponents={stepComponents}
        currentStep={workflow.current_step}
        contextData={workflow.context_data}
        onStepComplete={handleStepComplete}
        onComplete={handleComplete}
        onSaveDraft={handleSaveDraft}
        onCancel={handleCancel}
        autoSave={true}
        patient={workflow.patient}
      />
    </div>
  );
}
