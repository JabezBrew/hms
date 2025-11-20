import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { WorkflowProgress } from './WorkflowProgress';
import { ArrowLeft, ArrowRight, Save, CheckCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * WorkflowWizard Component
 * Manages multi-step workflow navigation and state
 *
 * Props:
 * - definition: Workflow definition object
 * - stepComponents: Object mapping step keys to React components
 * - currentStep: Current step number
 * - contextData: Workflow context data
 * - onStepComplete: Callback when step is completed
 * - onComplete: Callback when workflow is completed
 * - onSaveDraft: Callback for auto-save
 * - autoSave: Enable auto-save
 * - patient: Patient data for display
 */
export function WorkflowWizard({
  definition,
  stepComponents,
  currentStep = 1,
  contextData = {},
  onStepComplete,
  onComplete,
  onSaveDraft,
  onCancel,
  autoSave = true,
  patient,
}) {
  const [activeStep, setActiveStep] = useState(currentStep);
  const [stepData, setStepData] = useState({});
  const [errors, setErrors] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Auto-save effect
  useEffect(() => {
    if (!autoSave || !onSaveDraft) return;

    const interval = setInterval(() => {
      if (Object.keys(stepData).length > 0) {
        onSaveDraft(stepData);
      }
    }, definition.autoSaveInterval || 30000);

    return () => clearInterval(interval);
  }, [autoSave, stepData, onSaveDraft, definition.autoSaveInterval]);

  // Get current step definition
  const getCurrentStepDef = useCallback(() => {
    return definition.steps.find(s => s.id === activeStep);
  }, [activeStep, definition.steps]);

  // Handle step data change
  const handleStepDataChange = useCallback((data) => {
    setStepData(prev => ({
      ...prev,
      ...data,
    }));
    setErrors(null);
  }, []);

  // Navigate to next step
  const handleNext = async () => {
    const currentStepDef = getCurrentStepDef();

    // Validate current step if required
    if (currentStepDef.required && definition.validateStep) {
      const validation = definition.validateStep(currentStepDef.key, stepData);
      if (!validation.valid) {
        setErrors(validation.message);
        return;
      }
    }

    setIsProcessing(true);

    try {
      // Call onStepComplete callback
      const nextStep = activeStep + 1;
      await onStepComplete(stepData, nextStep <= definition.totalSteps ? nextStep : null);

      // Move to next step if not last
      if (activeStep < definition.totalSteps) {
        setActiveStep(nextStep);
        setErrors(null);
      }
    } catch (error) {
      setErrors(error.message || 'Failed to save progress');
    } finally {
      setIsProcessing(false);
    }
  };

  // Navigate to previous step
  const handlePrevious = () => {
    if (activeStep > 1) {
      setActiveStep(activeStep - 1);
      setErrors(null);
    }
  };

  // Complete workflow
  const handleComplete = async () => {
    const currentStepDef = getCurrentStepDef();

    // Validate final step
    if (currentStepDef.required && definition.validateStep) {
      const validation = definition.validateStep(currentStepDef.key, stepData);
      if (!validation.valid) {
        setErrors(validation.message);
        return;
      }
    }

    setIsProcessing(true);

    try {
      await onComplete(stepData);
    } catch (error) {
      setErrors(error.message || 'Failed to complete workflow');
      setIsProcessing(false);
    }
  };

  // Get step component
  const getCurrentStepComponent = () => {
    const stepDef = getCurrentStepDef();
    if (!stepDef) return null;

    const StepComponent = stepComponents[stepDef.component];
    if (!StepComponent) {
      console.error(`Step component ${stepDef.component} not found`);
      return <div>Error: Step component not found</div>;
    }

    return (
      <StepComponent
        contextData={contextData}
        stepData={stepData}
        onChange={handleStepDataChange}
        onComplete={handleNext}
        patient={patient}
      />
    );
  };

  const currentStepDef = getCurrentStepDef();
  const isFirstStep = activeStep === 1;
  const isLastStep = activeStep === definition.totalSteps;

  return (
    <div className="space-y-6">
      {/* Workflow Progress */}
      <WorkflowProgress
        steps={definition.steps}
        currentStep={activeStep}
        className="mb-6"
      />

      {/* Step Content */}
      <Card>
        <CardContent className="pt-6">
          {/* Step Title */}
          <div className="mb-6">
            <h2 className="text-2xl font-semibold">{currentStepDef?.title}</h2>
            <p className="text-muted-foreground mt-1">{currentStepDef?.description}</p>
          </div>

          {/* Error Alert */}
          {errors && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{errors}</AlertDescription>
            </Alert>
          )}

          {/* Step Component */}
          <div className="min-h-[400px]">
            {getCurrentStepComponent()}
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div>
          {onCancel && (
            <Button variant="outline" onClick={onCancel} disabled={isProcessing}>
              Cancel
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Previous Button */}
          {!isFirstStep && (
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={isProcessing}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Previous
            </Button>
          )}

          {/* Save Draft Button */}
          {onSaveDraft && !isLastStep && (
            <Button
              variant="secondary"
              onClick={() => onSaveDraft(stepData)}
              disabled={isProcessing}
            >
              <Save className="h-4 w-4 mr-2" />
              Save Draft
            </Button>
          )}

          {/* Next/Complete Button */}
          {!isLastStep ? (
            <Button onClick={handleNext} disabled={isProcessing}>
              {isProcessing ? 'Saving...' : 'Continue'}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={handleComplete} disabled={isProcessing}>
              {isProcessing ? 'Completing...' : 'Complete Consultation'}
              <CheckCircle className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
