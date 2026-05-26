import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MiniClinicalSummary } from "./ClinicalSummarySidebar";

/**
 * NoteWorkflowSteps - Renders step forms for each note type
 *
 * Step components for:
 * - Progress Note: Chief Complaint, Assessment, Plan
 * - SOAP Note: Subjective, Objective, Assessment, Plan
 * - Procedure Note: Pre-Procedure, Procedure Details, Post-Procedure
 * - Phone Note: Caller Info, Discussion, Action Items
 */
const NoteWorkflowSteps = ({
  noteType,
  currentStep,
  stepConfig,
  formData,
  onDataChange,
  patient
}) => {
  // Map note types and steps to components
  const stepComponents = {
    // Progress Note steps
    progress: {
      chief_complaint: ChiefComplaintStep,
      assessment: AssessmentStep,
      plan: PlanStep
    },
    // SOAP Note steps
    soap: {
      subjective: SubjectiveStep,
      objective: ObjectiveStep,
      assessment: AssessmentStep,
      plan: PlanStep
    },
    // Procedure Note steps
    procedure: {
      pre_procedure: PreProcedureStep,
      procedure_details: ProcedureDetailsStep,
      post_procedure: PostProcedureStep
    },
    // Phone Note steps
    phone: {
      caller_info: CallerInfoStep,
      discussion: DiscussionStep,
      action_items: ActionItemsStep
    }
  };

  const StepComponent = stepComponents[noteType]?.[stepConfig.id];

  if (!StepComponent) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Step component not found for {noteType}/{stepConfig.id}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-chronicle-enter">
      {/* Patient context mini-summary */}
      <MiniClinicalSummary
        patient={patient}
        allergies={extractAllergies(patient)}
        problems={[]}
      />

      {/* Step form */}
      <StepComponent
        data={formData[stepConfig.id] || {}}
        onChange={(data) => onDataChange(stepConfig.id, data)}
        patient={patient}
      />
    </div>
  );
};

// Helper to extract allergies from patient data
const extractAllergies = (patient) => {
  const localAllergies = patient?.local_data?.allergies;
  if (localAllergies) {
    if (typeof localAllergies === 'string') {
      return localAllergies.split(',').flatMap((allergy) => {
        const trimmed = allergy.trim();
        return trimmed ? [trimmed] : [];
      });
    }
    return localAllergies;
  }
  return patient?.allergies || [];
};

// ============================================
// Step Components - Progress Note
// ============================================

const ChiefComplaintStep = ({ data, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-display text-xl text-foreground mb-2">
          Chief Complaint
        </h4>
        <p className="font-mono text-xs text-muted-foreground mb-4">
          Document the patient's primary concern or reason for visit
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="chief_complaint" className="font-mono text-xs uppercase tracking-wider">
            Chief Complaint
          </Label>
          <Textarea
            id="chief_complaint"
            value={data.chief_complaint || ''}
            onChange={(e) => onChange({ ...data, chief_complaint: e.target.value })}
            placeholder="Patient presents with..."
            className="mt-2 min-h-[100px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="duration" className="font-mono text-xs uppercase tracking-wider">
            Duration of Symptoms
          </Label>
          <Input
            id="duration"
            value={data.duration || ''}
            onChange={(e) => onChange({ ...data, duration: e.target.value })}
            placeholder="e.g., 3 days, 2 weeks"
            className="mt-2 font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="severity" className="font-mono text-xs uppercase tracking-wider">
            Severity (1-10)
          </Label>
          <Select
            value={data.severity || ''}
            onValueChange={(value) => onChange({ ...data, severity: value })}
          >
            <SelectTrigger className="mt-2 font-mono text-sm">
              <SelectValue placeholder="Select severity" />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

const AssessmentStep = ({ data, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-display text-xl text-foreground mb-2">
          Assessment
        </h4>
        <p className="font-mono text-xs text-muted-foreground mb-4">
          Document your clinical assessment and diagnoses
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="assessment" className="font-mono text-xs uppercase tracking-wider">
            Clinical Assessment
          </Label>
          <Textarea
            id="assessment"
            value={data.assessment || ''}
            onChange={(e) => onChange({ ...data, assessment: e.target.value })}
            placeholder="Based on history and examination..."
            className="mt-2 min-h-[150px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="diagnoses" className="font-mono text-xs uppercase tracking-wider">
            Diagnoses / Differential
          </Label>
          <Textarea
            id="diagnoses"
            value={data.diagnoses || ''}
            onChange={(e) => onChange({ ...data, diagnoses: e.target.value })}
            placeholder="1. Primary diagnosis&#10;2. Differential diagnosis..."
            className="mt-2 min-h-[100px] font-mono text-sm"
          />
        </div>
      </div>
    </div>
  );
};

const PlanStep = ({ data, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-display text-xl text-foreground mb-2">
          Plan
        </h4>
        <p className="font-mono text-xs text-muted-foreground mb-4">
          Document the treatment plan and follow-up
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="treatment_plan" className="font-mono text-xs uppercase tracking-wider">
            Treatment Plan
          </Label>
          <Textarea
            id="treatment_plan"
            value={data.treatment_plan || ''}
            onChange={(e) => onChange({ ...data, treatment_plan: e.target.value })}
            placeholder="1. Medications&#10;2. Procedures&#10;3. Referrals..."
            className="mt-2 min-h-[150px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="follow_up" className="font-mono text-xs uppercase tracking-wider">
            Follow-up Instructions
          </Label>
          <Textarea
            id="follow_up"
            value={data.follow_up || ''}
            onChange={(e) => onChange({ ...data, follow_up: e.target.value })}
            placeholder="Return in X weeks, call if symptoms worsen..."
            className="mt-2 min-h-[80px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="patient_education" className="font-mono text-xs uppercase tracking-wider">
            Patient Education
          </Label>
          <Textarea
            id="patient_education"
            value={data.patient_education || ''}
            onChange={(e) => onChange({ ...data, patient_education: e.target.value })}
            placeholder="Discussed with patient..."
            className="mt-2 min-h-[80px] font-mono text-sm"
          />
        </div>
      </div>
    </div>
  );
};

// ============================================
// Step Components - SOAP Note (additional)
// ============================================

const SubjectiveStep = ({ data, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-display text-xl text-foreground mb-2">
          Subjective
        </h4>
        <p className="font-mono text-xs text-muted-foreground mb-4">
          Document the patient's symptoms and history in their own words
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="chief_complaint" className="font-mono text-xs uppercase tracking-wider">
            Chief Complaint
          </Label>
          <Textarea
            id="chief_complaint"
            value={data.chief_complaint || ''}
            onChange={(e) => onChange({ ...data, chief_complaint: e.target.value })}
            placeholder="Patient states..."
            className="mt-2 min-h-[80px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="hpi" className="font-mono text-xs uppercase tracking-wider">
            History of Present Illness
          </Label>
          <Textarea
            id="hpi"
            value={data.hpi || ''}
            onChange={(e) => onChange({ ...data, hpi: e.target.value })}
            placeholder="Onset, location, duration, character, aggravating/relieving factors, radiation, timing, severity..."
            className="mt-2 min-h-[120px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="ros" className="font-mono text-xs uppercase tracking-wider">
            Review of Systems
          </Label>
          <Textarea
            id="ros"
            value={data.ros || ''}
            onChange={(e) => onChange({ ...data, ros: e.target.value })}
            placeholder="Constitutional, Eyes, ENT, Cardiovascular, Respiratory..."
            className="mt-2 min-h-[100px] font-mono text-sm"
          />
        </div>
      </div>
    </div>
  );
};

const ObjectiveStep = ({ data, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-display text-xl text-foreground mb-2">
          Objective
        </h4>
        <p className="font-mono text-xs text-muted-foreground mb-4">
          Document physical exam findings and vital signs
        </p>
      </div>

      <div className="space-y-4">
        {/* Vital Signs Grid */}
        <div>
          <Label className="font-mono text-xs uppercase tracking-wider">
            Vital Signs
          </Label>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <Input
                placeholder="BP (e.g., 120/80)"
                value={data.bp || ''}
                onChange={(e) => onChange({ ...data, bp: e.target.value })}
                className="font-mono text-sm"
              />
            </div>
            <div>
              <Input
                placeholder="HR (e.g., 72)"
                value={data.hr || ''}
                onChange={(e) => onChange({ ...data, hr: e.target.value })}
                className="font-mono text-sm"
              />
            </div>
            <div>
              <Input
                placeholder="Temp (e.g., 98.6)"
                value={data.temp || ''}
                onChange={(e) => onChange({ ...data, temp: e.target.value })}
                className="font-mono text-sm"
              />
            </div>
            <div>
              <Input
                placeholder="SpO2 (e.g., 98%)"
                value={data.spo2 || ''}
                onChange={(e) => onChange({ ...data, spo2: e.target.value })}
                className="font-mono text-sm"
              />
            </div>
          </div>
        </div>

        <div>
          <Label htmlFor="general_appearance" className="font-mono text-xs uppercase tracking-wider">
            General Appearance
          </Label>
          <Textarea
            id="general_appearance"
            value={data.general_appearance || ''}
            onChange={(e) => onChange({ ...data, general_appearance: e.target.value })}
            placeholder="Alert, oriented, no acute distress..."
            className="mt-2 min-h-[60px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="physical_exam" className="font-mono text-xs uppercase tracking-wider">
            Physical Examination
          </Label>
          <Textarea
            id="physical_exam"
            value={data.physical_exam || ''}
            onChange={(e) => onChange({ ...data, physical_exam: e.target.value })}
            placeholder="HEENT: Normocephalic...&#10;Neck: Supple...&#10;Lungs: Clear to auscultation...&#10;Heart: RRR, no murmurs..."
            className="mt-2 min-h-[150px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="lab_results" className="font-mono text-xs uppercase tracking-wider">
            Labs/Imaging Results
          </Label>
          <Textarea
            id="lab_results"
            value={data.lab_results || ''}
            onChange={(e) => onChange({ ...data, lab_results: e.target.value })}
            placeholder="Pertinent lab and imaging findings..."
            className="mt-2 min-h-[80px] font-mono text-sm"
          />
        </div>
      </div>
    </div>
  );
};

// ============================================
// Step Components - Procedure Note
// ============================================

const PreProcedureStep = ({ data, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-display text-xl text-foreground mb-2">
          Pre-Procedure
        </h4>
        <p className="font-mono text-xs text-muted-foreground mb-4">
          Document pre-procedure assessment and preparation
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="procedure_name" className="font-mono text-xs uppercase tracking-wider">
            Procedure Name
          </Label>
          <Input
            id="procedure_name"
            value={data.procedure_name || ''}
            onChange={(e) => onChange({ ...data, procedure_name: e.target.value })}
            placeholder="e.g., Central Line Insertion"
            className="mt-2 font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="indication" className="font-mono text-xs uppercase tracking-wider">
            Indication
          </Label>
          <Textarea
            id="indication"
            value={data.indication || ''}
            onChange={(e) => onChange({ ...data, indication: e.target.value })}
            placeholder="Reason for procedure..."
            className="mt-2 min-h-[80px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="consent" className="font-mono text-xs uppercase tracking-wider">
            Consent
          </Label>
          <Select
            value={data.consent || ''}
            onValueChange={(value) => onChange({ ...data, consent: value })}
          >
            <SelectTrigger className="mt-2 font-mono text-sm">
              <SelectValue placeholder="Select consent status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="obtained">Informed consent obtained</SelectItem>
              <SelectItem value="emergency">Emergency - consent waived</SelectItem>
              <SelectItem value="surrogate">Surrogate consent obtained</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="pre_assessment" className="font-mono text-xs uppercase tracking-wider">
            Pre-Procedure Assessment
          </Label>
          <Textarea
            id="pre_assessment"
            value={data.pre_assessment || ''}
            onChange={(e) => onChange({ ...data, pre_assessment: e.target.value })}
            placeholder="Vitals, allergies confirmed, site marked..."
            className="mt-2 min-h-[100px] font-mono text-sm"
          />
        </div>
      </div>
    </div>
  );
};

const ProcedureDetailsStep = ({ data, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-display text-xl text-foreground mb-2">
          Procedure Details
        </h4>
        <p className="font-mono text-xs text-muted-foreground mb-4">
          Document the procedure performed
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="anesthesia" className="font-mono text-xs uppercase tracking-wider">
            Anesthesia/Sedation
          </Label>
          <Input
            id="anesthesia"
            value={data.anesthesia || ''}
            onChange={(e) => onChange({ ...data, anesthesia: e.target.value })}
            placeholder="e.g., 1% lidocaine local"
            className="mt-2 font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="technique" className="font-mono text-xs uppercase tracking-wider">
            Technique / Description
          </Label>
          <Textarea
            id="technique"
            value={data.technique || ''}
            onChange={(e) => onChange({ ...data, technique: e.target.value })}
            placeholder="Step-by-step description of procedure..."
            className="mt-2 min-h-[150px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="specimens" className="font-mono text-xs uppercase tracking-wider">
            Specimens Collected
          </Label>
          <Input
            id="specimens"
            value={data.specimens || ''}
            onChange={(e) => onChange({ ...data, specimens: e.target.value })}
            placeholder="e.g., Tissue sent to pathology"
            className="mt-2 font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="ebl" className="font-mono text-xs uppercase tracking-wider">
            Estimated Blood Loss
          </Label>
          <Input
            id="ebl"
            value={data.ebl || ''}
            onChange={(e) => onChange({ ...data, ebl: e.target.value })}
            placeholder="e.g., Minimal, <10cc"
            className="mt-2 font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="complications" className="font-mono text-xs uppercase tracking-wider">
            Complications
          </Label>
          <Select
            value={data.complications || ''}
            onValueChange={(value) => onChange({ ...data, complications: value })}
          >
            <SelectTrigger className="mt-2 font-mono text-sm">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="minor">Minor complication</SelectItem>
              <SelectItem value="major">Major complication</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {data.complications && data.complications !== 'none' && (
          <div>
            <Label htmlFor="complication_details" className="font-mono text-xs uppercase tracking-wider">
              Complication Details
            </Label>
            <Textarea
              id="complication_details"
              value={data.complication_details || ''}
              onChange={(e) => onChange({ ...data, complication_details: e.target.value })}
              placeholder="Describe complication and management..."
              className="mt-2 min-h-[80px] font-mono text-sm"
            />
          </div>
        )}
      </div>
    </div>
  );
};

const PostProcedureStep = ({ data, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-display text-xl text-foreground mb-2">
          Post-Procedure
        </h4>
        <p className="font-mono text-xs text-muted-foreground mb-4">
          Document post-procedure status and instructions
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="patient_condition" className="font-mono text-xs uppercase tracking-wider">
            Patient Condition
          </Label>
          <Textarea
            id="patient_condition"
            value={data.patient_condition || ''}
            onChange={(e) => onChange({ ...data, patient_condition: e.target.value })}
            placeholder="Patient tolerated procedure well..."
            className="mt-2 min-h-[80px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="disposition" className="font-mono text-xs uppercase tracking-wider">
            Disposition
          </Label>
          <Select
            value={data.disposition || ''}
            onValueChange={(value) => onChange({ ...data, disposition: value })}
          >
            <SelectTrigger className="mt-2 font-mono text-sm">
              <SelectValue placeholder="Select disposition" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="discharge">Discharge home</SelectItem>
              <SelectItem value="observation">Observation</SelectItem>
              <SelectItem value="admit">Admit to hospital</SelectItem>
              <SelectItem value="icu">Transfer to ICU</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="post_instructions" className="font-mono text-xs uppercase tracking-wider">
            Post-Procedure Instructions
          </Label>
          <Textarea
            id="post_instructions"
            value={data.post_instructions || ''}
            onChange={(e) => onChange({ ...data, post_instructions: e.target.value })}
            placeholder="Wound care, activity restrictions, warning signs..."
            className="mt-2 min-h-[100px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="follow_up" className="font-mono text-xs uppercase tracking-wider">
            Follow-up Plan
          </Label>
          <Textarea
            id="follow_up"
            value={data.follow_up || ''}
            onChange={(e) => onChange({ ...data, follow_up: e.target.value })}
            placeholder="Return for wound check in X days..."
            className="mt-2 min-h-[80px] font-mono text-sm"
          />
        </div>
      </div>
    </div>
  );
};

// ============================================
// Step Components - Phone Note
// ============================================

const CallerInfoStep = ({ data, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-display text-xl text-foreground mb-2">
          Caller Information
        </h4>
        <p className="font-mono text-xs text-muted-foreground mb-4">
          Document who called and their relationship
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="caller_name" className="font-mono text-xs uppercase tracking-wider">
            Caller Name
          </Label>
          <Input
            id="caller_name"
            value={data.caller_name || ''}
            onChange={(e) => onChange({ ...data, caller_name: e.target.value })}
            placeholder="Name of caller"
            className="mt-2 font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="relationship" className="font-mono text-xs uppercase tracking-wider">
            Relationship to Patient
          </Label>
          <Select
            value={data.relationship || ''}
            onValueChange={(value) => onChange({ ...data, relationship: value })}
          >
            <SelectTrigger className="mt-2 font-mono text-sm">
              <SelectValue placeholder="Select relationship" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self">Patient (Self)</SelectItem>
              <SelectItem value="spouse">Spouse/Partner</SelectItem>
              <SelectItem value="parent">Parent</SelectItem>
              <SelectItem value="child">Child</SelectItem>
              <SelectItem value="caregiver">Caregiver</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="callback_number" className="font-mono text-xs uppercase tracking-wider">
            Callback Number
          </Label>
          <Input
            id="callback_number"
            value={data.callback_number || ''}
            onChange={(e) => onChange({ ...data, callback_number: e.target.value })}
            placeholder="Phone number"
            className="mt-2 font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="reason_for_call" className="font-mono text-xs uppercase tracking-wider">
            Reason for Call
          </Label>
          <Textarea
            id="reason_for_call"
            value={data.reason_for_call || ''}
            onChange={(e) => onChange({ ...data, reason_for_call: e.target.value })}
            placeholder="Brief description of why they called..."
            className="mt-2 min-h-[80px] font-mono text-sm"
          />
        </div>
      </div>
    </div>
  );
};

const DiscussionStep = ({ data, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-display text-xl text-foreground mb-2">
          Discussion
        </h4>
        <p className="font-mono text-xs text-muted-foreground mb-4">
          Document the conversation details
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="symptoms_discussed" className="font-mono text-xs uppercase tracking-wider">
            Symptoms/Concerns Discussed
          </Label>
          <Textarea
            id="symptoms_discussed"
            value={data.symptoms_discussed || ''}
            onChange={(e) => onChange({ ...data, symptoms_discussed: e.target.value })}
            placeholder="What symptoms or concerns were discussed..."
            className="mt-2 min-h-[120px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="advice_given" className="font-mono text-xs uppercase tracking-wider">
            Advice/Recommendations Given
          </Label>
          <Textarea
            id="advice_given"
            value={data.advice_given || ''}
            onChange={(e) => onChange({ ...data, advice_given: e.target.value })}
            placeholder="What advice or recommendations were provided..."
            className="mt-2 min-h-[120px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="urgency" className="font-mono text-xs uppercase tracking-wider">
            Clinical Urgency
          </Label>
          <Select
            value={data.urgency || ''}
            onValueChange={(value) => onChange({ ...data, urgency: value })}
          >
            <SelectTrigger className="mt-2 font-mono text-sm">
              <SelectValue placeholder="Select urgency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="routine">Routine - Non-urgent</SelectItem>
              <SelectItem value="soon">Soon - Schedule appointment</SelectItem>
              <SelectItem value="urgent">Urgent - Same day evaluation</SelectItem>
              <SelectItem value="emergent">Emergent - ED referral</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

const ActionItemsStep = ({ data, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-display text-xl text-foreground mb-2">
          Action Items
        </h4>
        <p className="font-mono text-xs text-muted-foreground mb-4">
          Document follow-up actions and next steps
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="actions_taken" className="font-mono text-xs uppercase tracking-wider">
            Actions Taken
          </Label>
          <Textarea
            id="actions_taken"
            value={data.actions_taken || ''}
            onChange={(e) => onChange({ ...data, actions_taken: e.target.value })}
            placeholder="e.g., Prescription called in, appointment scheduled..."
            className="mt-2 min-h-[100px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="pending_actions" className="font-mono text-xs uppercase tracking-wider">
            Pending Actions
          </Label>
          <Textarea
            id="pending_actions"
            value={data.pending_actions || ''}
            onChange={(e) => onChange({ ...data, pending_actions: e.target.value })}
            placeholder="e.g., Awaiting lab results, will call back tomorrow..."
            className="mt-2 min-h-[80px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="follow_up_plan" className="font-mono text-xs uppercase tracking-wider">
            Follow-up Plan
          </Label>
          <Textarea
            id="follow_up_plan"
            value={data.follow_up_plan || ''}
            onChange={(e) => onChange({ ...data, follow_up_plan: e.target.value })}
            placeholder="When and how to follow up..."
            className="mt-2 min-h-[80px] font-mono text-sm"
          />
        </div>

        <div>
          <Label htmlFor="callback_needed" className="font-mono text-xs uppercase tracking-wider">
            Callback Needed
          </Label>
          <Select
            value={data.callback_needed || ''}
            onValueChange={(value) => onChange({ ...data, callback_needed: value })}
          >
            <SelectTrigger className="mt-2 font-mono text-sm">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no">No callback needed</SelectItem>
              <SelectItem value="yes">Yes - callback required</SelectItem>
              <SelectItem value="if_needed">Only if results abnormal</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

export default NoteWorkflowSteps;
export { NoteWorkflowSteps };
