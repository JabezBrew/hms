/**
 * Consultation Workflow Definition
 * Defines the structure and steps for clinical consultation workflow
 */

export const CONSULTATION_WORKFLOW = {
  type: 'consultation',
  name: 'Clinical Consultation',
  totalSteps: 3, // Simplified to 3 steps for prototype
  steps: [
    {
      id: 1,
      key: 'prep',
      title: 'Patient Review',
      description: 'Review patient history and context',
      required: false, // Auto-loaded, no user input required
      component: 'PrepStep',
      validationRules: [],
    },
    {
      id: 2,
      key: 'history',
      title: 'History & Exam',
      description: 'Document chief complaint, HPI, and physical exam',
      required: true,
      component: 'HistoryStep',
      validationRules: ['chief_complaint_required'],
    },
    {
      id: 3,
      key: 'assessment',
      title: 'Assessment & Plan',
      description: 'Formulate assessment and treatment plan',
      required: true,
      component: 'AssessmentStep',
      validationRules: ['assessment_required'],
    },
  ],
  autoSave: true,
  autoSaveInterval: 30000, // 30 seconds
};

/**
 * Validation rules for consultation workflow
 */
export const VALIDATION_RULES = {
  chief_complaint_required: (data) => {
    if (!data.chief_complaint || data.chief_complaint.trim() === '') {
      return {
        valid: false,
        message: 'Chief complaint is required',
      };
    }
    return { valid: true };
  },

  assessment_required: (data) => {
    if (!data.assessment || data.assessment.trim() === '') {
      return {
        valid: false,
        message: 'Assessment is required to complete consultation',
      };
    }
    return { valid: true };
  },
};

/**
 * Validate step data against defined rules
 */
export function validateStep(stepKey, data) {
  const step = CONSULTATION_WORKFLOW.steps.find(s => s.key === stepKey);
  if (!step || !step.validationRules || step.validationRules.length === 0) {
    return { valid: true };
  }

  for (const ruleName of step.validationRules) {
    const rule = VALIDATION_RULES[ruleName];
    if (rule) {
      const result = rule(data);
      if (!result.valid) {
        return result;
      }
    }
  }

  return { valid: true };
}
