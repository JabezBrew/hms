import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import { useState, useEffect, useMemo, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  useUpdatePatientWithFHIR,
  useRegisterPatient,
  usePatientValidationRules,
  usePatientSearch,
} from "@/features/patients/hooks/usePatientQueries";
import { useWardBeds } from "@/features/wards/hooks/useWardQueries";
import { useDepartments, useRosterOnDutyDepartment, useUnitWards } from "@/features/admin/hooks";
import {
  useInsuranceProviders,
  useInsurancePlans,
  useCreatePatientInsurance,
} from "@/features/billing/hooks";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { TeamSelectionField } from "@/components/registration/TeamSelectionField";

import format from "date-fns/format";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { useSystemCapabilities } from "@/hooks/useSystemQueries";

// Form validation schema
const patientFormSchema = z.object({
  // User fields
  email: z.string().email({ message: "Please enter a valid email address" }),
  first_name: z.string().min(1, { message: "First name is required" }),
  last_name: z.string().min(1, { message: "Last name is required" }),
  phone_number: z.string().optional(),
  // Required for registration; optional for edit flows that may be missing DOB.
  date_of_birth: z.date().optional(),

  // PatientProfile fields
  medical_record_number: z.string().optional(), // Made optional as it will be generated on the backend
  nhis_id: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z.string().optional(),
  emergency_contact_relationship: z.string().optional(),

  // Address fields
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
});

const PatientForm = ({ patient, onSuccess }) => {
  const navigate = useNavigate();
  const isEditMode = !!patient;

  const [isLoading, setIsLoading] = useState(false);
  const [showValidation, setShowValidation] = useState(false);

  // Registration-only encounter state
  const [admissionType, setAdmissionType] = useState("outpatient");
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [selectedClinic, setSelectedClinic] = useState("");
  const [selectedPrimaryTeam, setSelectedPrimaryTeam] = useState("");
  const [activeClinicOptions, setActiveClinicOptions] = useState([]);
  const [clinicSelectionRequired, setClinicSelectionRequired] = useState(false);

  const [isWaitingList, setIsWaitingList] = useState(false);
  const [selectedWard, setSelectedWard] = useState("");

  // "No email" support: backend requires a unique email; generate a safe placeholder when needed.
  const [noEmail, setNoEmail] = useState(false);
  const generatedNoEmail = useMemo(() => {
    try {
      const uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return `no-email+${uuid}@hms.invalid`;
    } catch (_e) {
      return `no-email+${Date.now()}-${Math.random().toString(16).slice(2)}@hms.invalid`;
    }
  }, []);

  const stepDefs = useMemo(() => {
    if (isEditMode) {
      return [
        { key: 'identity', label: 'Identity' },
        { key: 'contact', label: 'Contact' },
        { key: 'review', label: 'Review' },
      ];
    }
    return [
      { key: 'encounter', label: 'Encounter' },
      { key: 'identity', label: 'Identity' },
      { key: 'contact', label: 'Contact' },
      { key: 'insurance', label: 'Insurance' },
      { key: 'review', label: 'Review' },
    ];
  }, [isEditMode]);
  const stepKeys = useMemo(() => stepDefs.map((s) => s.key), [stepDefs]);
  const [activeStep, setActiveStep] = useState(stepKeys[0]);
  useEffect(() => {
    if (!stepKeys.includes(activeStep)) {
      setActiveStep(stepKeys[0]);
    }
  }, [activeStep, stepKeys]);

  // Use React Query hooks
  const { data: validationRules = [] } = usePatientValidationRules();
  const updatePatientMutation = useUpdatePatientWithFHIR();
  const registerPatientMutation = useRegisterPatient();
  const { data: deploymentCapabilities } = useSystemCapabilities();
  const outpatientRequiresActiveClinicSchedule =
    deploymentCapabilities?.capabilities?.outpatient_requires_active_clinic_schedule ?? true;

  // Initialize form with default values
  const form = useForm({
    resolver: zodResolver(patientFormSchema),
    defaultValues: {
      email: "",
      first_name: "",
      last_name: "",
      phone_number: "",
      date_of_birth: undefined,
      medical_record_number: "",
      nhis_id: "",
      emergency_contact_name: "",
      emergency_contact_phone: "",
      emergency_contact_relationship: "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      postal_code: "",
      country: "",
      bed_id: "",
    }
  });

  // Load patient data into form when in edit mode
  useEffect(() => {
    if (!isEditMode || !patient) {
      return;
    }
    const phoneFromFhir = patient.fhir_data?.telecom?.find(t => t.system === 'phone')?.value || "";
    form.reset({
      email: patient.local_data?.user_details?.email || "",
      first_name: patient.local_data?.user_details?.first_name || "",
      last_name: patient.local_data?.user_details?.last_name || "",
      phone_number: patient.local_data?.user_details?.phone_number || phoneFromFhir || "",
      date_of_birth: patient.local_data?.user_details?.date_of_birth ? new Date(patient.local_data.user_details.date_of_birth) : undefined,
      medical_record_number: patient.local_data?.medical_record_number || "",
      nhis_id: patient.local_data?.nhis_id || "",
      emergency_contact_name: patient.local_data?.emergency_contact_name || "",
      emergency_contact_phone: patient.local_data?.emergency_contact_phone || "",
      emergency_contact_relationship: patient.local_data?.emergency_contact_relationship || "",
      address_line1: patient.fhir_data?.address?.[0]?.line?.[0] || "",
      address_line2: patient.fhir_data?.address?.[0]?.line?.[1] || "",
      city: patient.fhir_data?.address?.[0]?.city || "",
      state: patient.fhir_data?.address?.[0]?.state || "",
      postal_code: patient.fhir_data?.address?.[0]?.postalCode || "",
      country: patient.fhir_data?.address?.[0]?.country || "",
    });
  }, [isEditMode, patient, form]);

  // Keep email value in sync when "no email" is enabled.
  useEffect(() => {
    if (isEditMode) return;
    if (noEmail) {
      form.setValue('email', generatedNoEmail, { shouldDirty: true, shouldValidate: showValidation });
    } else {
      const current = form.getValues('email');
      if (current === generatedNoEmail) {
        form.setValue('email', '', { shouldDirty: true, shouldValidate: showValidation });
      }
    }
  }, [noEmail, generatedNoEmail, form, isEditMode, showValidation]);

  // Department and clinic queries (registration only)
  const { data: departmentsData, isLoading: isDepartmentsLoading } = useDepartments({
    enabled: !isEditMode && (activeStep === 'encounter' || activeStep === 'review' || !!selectedDepartment),
    staleTime: 5 * 60 * 1000,
  });
  const allUnits = Array.isArray(departmentsData) ? departmentsData : [];
  const departments = allUnits.filter(unit =>
    unit.unit_type_code === 'department' && unit.unit_category === 'clinical'
  );

  const { data: onDutyData } = useRosterOnDutyDepartment(
    selectedDepartment,
    {},
    { enabled: !isEditMode && !!selectedDepartment && admissionType === 'outpatient' }
  );

  const activeClinics = useMemo(() => {
    const results = Array.isArray(onDutyData) ? onDutyData : (onDutyData?.results || []);
    const clinicEntries = results.filter((entry) => entry.duty_type_category === 'clinic');
    const seen = new Set();
    return clinicEntries.reduce((acc, entry) => {
      const uniqueId = entry.clinic_id || entry.duty_type_id;
      if (seen.has(uniqueId)) return acc;
      seen.add(uniqueId);
      acc.push({
        id: entry.clinic_id || entry.duty_type_id,
        name: entry.clinic_name || entry.duty_type_name,
        duty_type_id: entry.duty_type_id,
        duty_type_name: entry.duty_type_name,
        is_duty_type: !entry.clinic_id,
      });
      return acc;
    }, []);
  }, [onDutyData]);

  useEffect(() => {
    if (isEditMode || admissionType !== 'outpatient' || !selectedDepartment) {
      setActiveClinicOptions([]);
      setClinicSelectionRequired(false);
      return;
    }

    setActiveClinicOptions(activeClinics);

    if (activeClinics.length === 1) {
      setSelectedClinic(activeClinics[0].id);
      setClinicSelectionRequired(false);
    } else if (activeClinics.length > 1) {
      const requiresSelection = outpatientRequiresActiveClinicSchedule;
      setClinicSelectionRequired(requiresSelection);
      if (requiresSelection && !activeClinics.some((clinic) => clinic.id === selectedClinic)) {
        setSelectedClinic("");
      }
    } else {
      setClinicSelectionRequired(false);
      setSelectedClinic("");
    }
  }, [
    activeClinics,
    selectedDepartment,
    admissionType,
    isEditMode,
    outpatientRequiresActiveClinicSchedule,
    selectedClinic,
  ]);

  // Inpatient wards/beds (registration only): fetch wards from the selected department to avoid cross-department mismatches.
  const wardsQueryEnabled =
    !isEditMode &&
    admissionType === 'inpatient' &&
    !!selectedDepartment &&
    !isWaitingList &&
    (activeStep === 'encounter' || activeStep === 'review');
  const { data: unitWards = [], isLoading: isWardsLoading } = useUnitWards(selectedDepartment, { enabled: wardsQueryEnabled });
  const { data: beds = [] } = useWardBeds(selectedWard, { status: 'available' });

  // Insurance queries and state (registration only)
  const createInsuranceMutation = useCreatePatientInsurance();
  const [insuranceData, setInsuranceData] = useState({
    hasInsurance: false,
    plan: '',
    policy_number: '',
    valid_from: null,
    valid_until: null,
  });
  const [selectedProviderId, setSelectedProviderId] = useState('');

  const insuranceQueryEnabled = !isEditMode && insuranceData.hasInsurance && (activeStep === 'insurance' || activeStep === 'review');
  const { data: providersData } = useInsuranceProviders({}, { enabled: insuranceQueryEnabled });
  const providers = providersData?.results || providersData || [];

  const plansQueryEnabled = insuranceQueryEnabled && !!selectedProviderId;
  const { data: plansData } = useInsurancePlans(
    selectedProviderId ? { provider: selectedProviderId } : {},
    { enabled: plansQueryEnabled }
  );
  const plans = plansData?.results || plansData || [];

  // Possible matches (registration only): debounce name query and filter by DOB.
  const firstName = form.watch('first_name');
  const lastName = form.watch('last_name');
  const dobValue = form.watch('date_of_birth');
  const dobString = dobValue ? format(dobValue, 'yyyy-MM-dd') : null;
  const searchName = `${firstName || ''} ${lastName || ''}`.trim();
  const debouncedSearchName = useDebounce(searchName, 350);
  const possibleMatchesParams = useMemo(() => ({
    query: debouncedSearchName,
    page_size: 10,
    ordering: '-created_at',
  }), [debouncedSearchName]);
  const canSearchMatches =
    !isEditMode &&
    activeStep === 'identity' &&
    !!dobString &&
    debouncedSearchName.length >= 3;
  const { data: possibleMatchesData, isLoading: isMatchesLoading } = usePatientSearch(possibleMatchesParams, {
    enabled: canSearchMatches,
    staleTime: 30 * 1000,
  });
  const possibleMatches = useMemo(() => {
    const results = possibleMatchesData?.results || possibleMatchesData || [];
    if (!dobString || !Array.isArray(results)) return [];
    return results
      .filter((p) => p?.date_of_birth === dobString)
      .slice(0, 5);
  }, [possibleMatchesData, dobString]);

  // Server-driven validation rules (pre-submit): apply required + regex checks client-side.
  const rulesByField = useMemo(() => {
    const map = new Map();
    (Array.isArray(validationRules) ? validationRules : []).forEach((rule) => {
      if (!rule?.field_name) return;
      const list = map.get(rule.field_name) || [];
      list.push(rule);
      map.set(rule.field_name, list);
    });
    return map;
  }, [validationRules]);

  const isRuleRequired = useCallback((fieldName) => {
    const rules = rulesByField.get(fieldName) || [];
    return rules.some((r) => r.is_required);
  }, [rulesByField]);

  const applyRules = useCallback((values, fieldNames = null) => {
    const errors = [];
    const names = fieldNames || Array.from(rulesByField.keys());
    for (const fieldName of names) {
      const rules = rulesByField.get(fieldName) || [];
      if (!rules.length) continue;
      const value = values[fieldName];
      const valueStr = value === undefined || value === null ? '' : String(value);
      for (const rule of rules) {
        if (rule.is_required && valueStr.trim() === '') {
          errors.push({ field: fieldName, message: rule.validation_message || `${fieldName} is required` });
          break;
        }
        if (rule.validation_regex && valueStr.trim() !== '') {
          try {
            const pattern = String(rule.validation_regex);
            const anchored = pattern.startsWith('^') ? pattern : `^(?:${pattern})`;
            const re = new RegExp(anchored);
            if (!re.test(valueStr)) {
              errors.push({ field: fieldName, message: rule.validation_message || `${fieldName} is invalid` });
              break;
            }
          } catch (_e) {
            // If regex is not JS-compatible, skip client-side and let the server validate.
          }
        }
      }
    }
    return errors;
  }, [rulesByField]);

  const encounterBlocksOutpatient =
    !isEditMode &&
    admissionType === 'outpatient' &&
    !!selectedDepartment &&
    outpatientRequiresActiveClinicSchedule &&
    activeClinicOptions.length === 0;

  const validateEncounterStep = useCallback(() => {
    if (isEditMode) return true;
    if (!selectedDepartment) return false;
    if (admissionType === 'outpatient' && encounterBlocksOutpatient) return false;
    if (admissionType === 'outpatient' && clinicSelectionRequired && !selectedClinic) return false;
    return true;
  }, [isEditMode, selectedDepartment, admissionType, encounterBlocksOutpatient, clinicSelectionRequired, selectedClinic]);

  const validateInsuranceStep = useCallback(() => {
    if (isEditMode) return true;
    if (!insuranceData.hasInsurance) return true;
    if (!selectedProviderId) return false;
    if (!insuranceData.plan) return false;
    if (!insuranceData.policy_number?.trim()) return false;
    return true;
  }, [insuranceData.hasInsurance, insuranceData.plan, insuranceData.policy_number, selectedProviderId, isEditMode]);

  const getValuesForRules = useCallback(() => {
    const raw = form.getValues();
    // Convert to string forms that roughly match what the backend receives.
    return {
      ...raw,
      date_of_birth: raw.date_of_birth ? format(raw.date_of_birth, 'yyyy-MM-dd') : '',
    };
  }, [form]);

  const validateStep = useCallback(async (stepKey) => {
    if (stepKey === 'encounter') {
      return validateEncounterStep();
    }

    if (stepKey === 'insurance') {
      return validateInsuranceStep();
    }

    const stepFields = {
      identity: ['first_name', 'last_name', 'date_of_birth', 'email', 'phone_number', 'nhis_id'],
      contact: [
        'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country',
        'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
      ],
      review: [],
    };

    const fields = stepFields[stepKey] || [];
    if (fields.length) {
      const ok = await form.trigger(fields);
      if (!ok) return false;
    }

    // Registration requires DOB (schema allows optional for edit).
    if (!isEditMode && stepKey === 'identity' && !form.getValues('date_of_birth')) {
      form.setError('date_of_birth', { type: 'manual', message: 'Date of birth is required' });
      return false;
    }

    // If "no email" is selected, require phone number.
    if (!isEditMode && stepKey === 'identity' && noEmail && !form.getValues('phone_number')?.trim()) {
      form.setError('phone_number', { type: 'manual', message: 'Phone number is required when email is unavailable' });
      return false;
    }

    // Apply server-driven validation rules for the fields on this step.
    const ruleErrors = applyRules(getValuesForRules(), fields.length ? fields : null);
    if (ruleErrors.length) {
      ruleErrors.forEach(({ field, message }) => {
        if (fields.length && !fields.includes(field)) return;
        form.setError(field, { type: 'manual', message });
      });
      return false;
    }
    return true;
  }, [applyRules, form, getValuesForRules, isEditMode, noEmail, validateEncounterStep, validateInsuranceStep]);

  const currentStepIndex = stepKeys.indexOf(activeStep);
  const isFirstStep = currentStepIndex <= 0;
  const isLastStep = currentStepIndex === stepKeys.length - 1;
  const isSubmitting =
    isLoading ||
    registerPatientMutation.isPending ||
    updatePatientMutation.isPending ||
    createInsuranceMutation.isPending;

  const goToStep = useCallback((stepKey, focusField = null) => {
    setActiveStep(stepKey);
    if (focusField) {
      setTimeout(() => form.setFocus(focusField), 0);
    }
  }, [form]);

  const goToFirstErrorStep = useCallback(() => {
    if (!isEditMode && !validateEncounterStep()) {
      goToStep('encounter');
      return;
    }
    const errors = form.formState.errors || {};
    const order = stepKeys;
    const fieldToStep = {
      first_name: 'identity',
      last_name: 'identity',
      date_of_birth: 'identity',
      email: 'identity',
      phone_number: 'identity',
      nhis_id: 'identity',
      address_line1: 'contact',
      address_line2: 'contact',
      city: 'contact',
      state: 'contact',
      postal_code: 'contact',
      country: 'contact',
      emergency_contact_name: 'contact',
      emergency_contact_phone: 'contact',
      emergency_contact_relationship: 'contact',
    };
    const errorFields = Object.keys(errors);
    for (const step of order) {
      const has = errorFields.some((f) => fieldToStep[f] === step);
      if (has) {
        const firstField = errorFields.find((f) => fieldToStep[f] === step);
        goToStep(step, firstField);
        return;
      }
    }
  }, [form.formState.errors, goToStep, isEditMode, stepKeys, validateEncounterStep]);

  const handleBack = useCallback(() => {
    if (isFirstStep) return;
    setShowValidation(false);
    setActiveStep(stepKeys[currentStepIndex - 1]);
  }, [currentStepIndex, isFirstStep, stepKeys]);

  const handleNext = useCallback(async () => {
    setShowValidation(true);
    const ok = await validateStep(activeStep);
    if (!ok) {
      goToFirstErrorStep();
      return false;
    }
    if (isLastStep) return true;
    setActiveStep(stepKeys[currentStepIndex + 1]);
    return true;
  }, [activeStep, currentStepIndex, goToFirstErrorStep, isLastStep, stepKeys, validateStep]);

  const submitUpdate = useCallback((data) => {
    setIsLoading(true);
    const updateDob = data.date_of_birth ? format(data.date_of_birth, 'yyyy-MM-dd') : undefined;
    const updateData = {
      local_data: {
        user: {
          email: data.email,
          first_name: data.first_name,
          last_name: data.last_name,
          phone_number: data.phone_number,
          date_of_birth: updateDob,
        },
        medical_record_number: data.medical_record_number,
        nhis_id: data.nhis_id,
        emergency_contact_name: data.emergency_contact_name,
        emergency_contact_phone: data.emergency_contact_phone,
        emergency_contact_relationship: data.emergency_contact_relationship,
      },
      fhir_data: {
        ...patient.fhir_data,
        name: [{ family: data.last_name, given: [data.first_name] }],
        telecom: data.phone_number ? [{ system: "phone", value: data.phone_number, use: "home" }] : (patient.fhir_data?.telecom || []),
        ...(updateDob ? { birthDate: updateDob } : {}),
        address: [
          {
            line: [data.address_line1, data.address_line2].filter(Boolean),
            city: data.city,
            state: data.state,
            postalCode: data.postal_code,
            country: data.country
          }
        ]
      }
    };

    updatePatientMutation.mutate(
      { id: patient.local_data.id, data: updateData },
      {
        onSuccess: (response) => {
          toast.success("Patient updated successfully");
          if (onSuccess) {
            const patientData = response.data !== undefined ? response.data : response;
            onSuccess(patientData);
          }
          setIsLoading(false);
        },
        onError: (error) => {
          toast.error(error.message || "Failed to update patient");
          setIsLoading(false);
        }
      }
    );
  }, [onSuccess, patient, updatePatientMutation]);

  const submitRegistration = useCallback((data) => {
    setIsLoading(true);

    if (!selectedDepartment) {
      toast.error("Please select a department");
      setIsLoading(false);
      return;
    }
    if (admissionType === 'outpatient' && encounterBlocksOutpatient) {
      toast.error("No clinics are scheduled right now for this department");
      setIsLoading(false);
      return;
    }
    if (admissionType === 'outpatient' && clinicSelectionRequired && !selectedClinic) {
      toast.error("Please select a clinic");
      setIsLoading(false);
      return;
    }
    if (!data.date_of_birth) {
      toast.error("Date of birth is required");
      setIsLoading(false);
      return;
    }
    if (noEmail && !data.phone_number?.trim()) {
      toast.error("Phone number is required when email is unavailable");
      setIsLoading(false);
      return;
    }

    const formattedData = {
      ...data,
      date_of_birth: format(data.date_of_birth, 'yyyy-MM-dd'),
    };

    const admissionDetails = {
      type: admissionType,
      department_id: selectedDepartment,
      notes: '',
    };

    if ((admissionType === 'inpatient' || admissionType === 'emergency') && selectedPrimaryTeam) {
      admissionDetails.primary_team_id = selectedPrimaryTeam;
    }

    if (admissionType === 'outpatient' && selectedClinic) {
      const selectedClinicOption = activeClinicOptions.find(c => c.id === selectedClinic);
      if (selectedClinicOption?.is_duty_type) {
        admissionDetails.duty_type_id = selectedClinic;
      } else {
        admissionDetails.clinic_id = selectedClinic;
      }
    }

    if (admissionType === 'inpatient') {
      if (!isWaitingList && data.bed_id) {
        admissionDetails.bed_id = data.bed_id;
      }
      if (!isWaitingList && selectedWard && !data.bed_id) {
        admissionDetails.ward_id = selectedWard;
      }
    }

    formattedData.admission_details = admissionDetails;

    registerPatientMutation.mutate(formattedData, {
      onSuccess: async (response) => {
        const patientData = response.data !== undefined ? response.data : response;
        const patientId = patientData.local_data?.id || patientData.id;

        if (insuranceData.hasInsurance && insuranceData.plan && insuranceData.policy_number && patientId) {
          try {
            await createInsuranceMutation.mutateAsync({
              patient: patientId,
              plan: insuranceData.plan,
              policy_number: insuranceData.policy_number,
              valid_from: insuranceData.valid_from ? format(insuranceData.valid_from, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
              valid_until: insuranceData.valid_until ? format(insuranceData.valid_until, 'yyyy-MM-dd') : null,
              is_active: true,
            });
            toast.success("Patient registered with insurance");
          } catch (_insuranceError) {
            toast.success("Patient registered successfully");
            toast.error("Failed to add insurance (you can add it later)");
          }
        } else {
          toast.success("Patient registered successfully");
        }

        if (onSuccess) {
          onSuccess(patientData);
        }
        setIsLoading(false);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to register patient");
        setIsLoading(false);
      }
    });
  }, [
    activeClinicOptions,
    admissionType,
    clinicSelectionRequired,
    createInsuranceMutation,
    encounterBlocksOutpatient,
    insuranceData,
    isWaitingList,
    noEmail,
    onSuccess,
    registerPatientMutation,
    selectedClinic,
    selectedDepartment,
    selectedPrimaryTeam,
    selectedWard,
  ]);

  const onFormSubmit = useCallback(async (data) => {
    // Enter key should act like "Next" until the review step.
    if (activeStep !== 'review') {
      await handleNext();
      return;
    }

    setShowValidation(true);
    for (const k of stepKeys) {
      // Validate sequentially to avoid overlapping `form.trigger()` calls.
      // The first failing step will set field errors and we can route the user there.
      // eslint-disable-next-line no-await-in-loop
      const ok = await validateStep(k);
      if (!ok) {
        goToFirstErrorStep();
        return;
      }
    }

    if (isEditMode) {
      submitUpdate(data);
      return;
    }
    submitRegistration(data);
  }, [activeStep, goToFirstErrorStep, handleNext, isEditMode, stepKeys, submitRegistration, submitUpdate, validateStep]);

  const tabColsClass =
    stepDefs.length === 5 ? 'grid-cols-5' :
    stepDefs.length === 4 ? 'grid-cols-4' :
    'grid-cols-3';

  const stepErrorCounts = useMemo(() => {
    const errors = form.formState.errors || {};
    const counts = Object.fromEntries(stepKeys.map((k) => [k, 0]));
    const fieldToStep = {
      first_name: 'identity',
      last_name: 'identity',
      date_of_birth: 'identity',
      email: 'identity',
      phone_number: 'identity',
      nhis_id: 'identity',
      address_line1: 'contact',
      address_line2: 'contact',
      city: 'contact',
      state: 'contact',
      postal_code: 'contact',
      country: 'contact',
      emergency_contact_name: 'contact',
      emergency_contact_phone: 'contact',
      emergency_contact_relationship: 'contact',
    };
    Object.keys(errors).forEach((field) => {
      const step = fieldToStep[field];
      if (step && counts[step] !== undefined) counts[step] += 1;
    });
    if (!isEditMode && showValidation) {
      if (!validateEncounterStep()) counts.encounter = (counts.encounter || 0) + 1;
      if (!validateInsuranceStep()) counts.insurance = (counts.insurance || 0) + 1;
    }
    return counts;
  }, [form.formState.errors, isEditMode, showValidation, stepKeys, validateEncounterStep, validateInsuranceStep]);

  const hasBlockingIssues = showValidation && !isEditMode && (encounterBlocksOutpatient || !validateEncounterStep() || !validateInsuranceStep());
  const hasFormErrors = Object.keys(form.formState.errors || {}).length > 0;

  return (
    <Card className="w-full border-border">
      <CardContent className="pt-6">
        {showValidation && (hasFormErrors || hasBlockingIssues) && (
          <Alert className="mb-6 border-amber-200 bg-amber-50/60 text-amber-950 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-100">
            <AlertCircle />
            <AlertTitle>Fix a few items to continue</AlertTitle>
            <AlertDescription>
              <div className="space-y-1">
                {!isEditMode && !selectedDepartment && (
                  <button
                    type="button"
                    className="text-left hover:underline font-mono text-xs"
                    onClick={() => goToStep('encounter')}
                  >
                    Encounter: select a department
                  </button>
                )}
                {!isEditMode && admissionType === 'outpatient' && encounterBlocksOutpatient && (
                  <button
                    type="button"
                    className="text-left hover:underline font-mono text-xs"
                    onClick={() => goToStep('encounter')}
                  >
                    Encounter: no clinics are scheduled right now for this department
                  </button>
                )}
                {!isEditMode && admissionType === 'outpatient' && clinicSelectionRequired && !selectedClinic && (
                  <button
                    type="button"
                    className="text-left hover:underline font-mono text-xs"
                    onClick={() => goToStep('encounter')}
                  >
                    Encounter: select a clinic
                  </button>
                )}
                {Object.entries(form.formState.errors || {}).map(([field, err]) => (
                  <button
                    key={field}
                    type="button"
                    className="text-left hover:underline font-mono text-xs"
                    onClick={() => goToFirstErrorStep()}
                  >
                    {String(err?.message || field)}
                  </button>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={activeStep} onValueChange={setActiveStep}>
          <TabsList className={cn("grid w-full mb-6", tabColsClass)}>
            {stepDefs.map((step, idx) => {
              const count = stepErrorCounts[step.key] || 0;
              return (
                <TabsTrigger key={step.key} value={step.key} className="font-mono text-xs">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-[10px]">
                      {idx + 1}
                    </span>
                    <span>{step.label}</span>
                    {count > 0 && (
                      <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                        {count}
                      </Badge>
                    )}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onFormSubmit)} className="space-y-6">
              {!isEditMode && (
                <TabsContent value="encounter" className="space-y-4 mt-4">
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      <Stethoscope className="h-4 w-4" />
                      Encounter Type
                    </label>
                    <RadioGroup
                      value={admissionType}
                      onValueChange={(val) => {
                        setAdmissionType(val);
                        setSelectedDepartment("");
                        setSelectedClinic("");
                        setSelectedPrimaryTeam("");
                        setSelectedWard("");
                        setIsWaitingList(false);
                        form.setValue("bed_id", "");
                      }}
                      className="flex flex-col space-y-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="outpatient" id="outpatient" />
                        <label htmlFor="outpatient" className="font-normal cursor-pointer">
                          Outpatient (Clinic visit)
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="inpatient" id="inpatient" />
                        <label htmlFor="inpatient" className="font-normal cursor-pointer">
                          Inpatient (Admit to ward)
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="emergency" id="emergency" />
                        <label htmlFor="emergency" className="font-normal cursor-pointer">
                          Emergency (ED triage)
                        </label>
                      </div>
                    </RadioGroup>
                  </div>

                  <Separator className="my-4" />

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      <Building2 className="h-4 w-4" />
                      Department
                      <span className="text-rose-500">*</span>
                    </label>
                    <Select
                      value={selectedDepartment}
                      onValueChange={(val) => {
                        setSelectedDepartment(val);
                        setSelectedClinic("");
                        setSelectedPrimaryTeam("");
                        setSelectedWard("");
                        setIsWaitingList(false);
                        form.setValue("bed_id", "");
                      }}
                    >
                      <SelectTrigger className={cn("font-mono", showValidation && !selectedDepartment && "border-rose-500")}>
                        <SelectValue placeholder={isDepartmentsLoading ? "Loading departments..." : "Select department"} />
                      </SelectTrigger>
                      <SelectContent>
                        {departments.map((dept) => (
                          <SelectItem key={dept.id} value={dept.id} className="font-mono">
                            {dept.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {showValidation && !selectedDepartment && (
                      <p className="text-xs text-rose-500 font-mono">Department is required for registration</p>
                    )}
                  </div>

                  {admissionType === 'outpatient' && selectedDepartment && (
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        <Stethoscope className="h-4 w-4" />
                        Clinic
                        {clinicSelectionRequired && <span className="text-rose-500">*</span>}
                      </label>

                      {activeClinicOptions.length === 0 ? (
                        outpatientRequiresActiveClinicSchedule ? (
                          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                              <p className="text-sm text-amber-700 dark:text-amber-300 font-mono">
                                No clinics are scheduled right now for this department. Choose another department or publish a roster session.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                              <p className="text-sm text-sky-700 dark:text-sky-300 font-mono">
                                No active clinic schedule found. Registration will continue under the selected department.
                              </p>
                            </div>
                          </div>
                        )
                      ) : activeClinicOptions.length === 1 ? (
                        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                          <div className="flex items-center gap-2">
                            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                            <p className="text-sm text-emerald-700 dark:text-emerald-300">
                              Auto-selected: <span className="font-mono font-medium">{activeClinicOptions[0].name}</span>
                            </p>
                          </div>
                        </div>
                      ) : (
                        <Select value={selectedClinic} onValueChange={setSelectedClinic}>
                          <SelectTrigger className={cn("font-mono", showValidation && clinicSelectionRequired && !selectedClinic && "border-rose-500")}>
                            <SelectValue placeholder="Select clinic" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeClinicOptions.map((clinic) => (
                              <SelectItem key={clinic.id} value={clinic.id} className="font-mono">
                                {clinic.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {clinicSelectionRequired && !selectedClinic && activeClinicOptions.length > 1 && showValidation && (
                        <p className="text-xs text-rose-500 font-mono">
                          Multiple clinics are active; please select one
                        </p>
                      )}
                    </div>
                  )}

                  {(admissionType === 'inpatient' || admissionType === 'emergency') && selectedDepartment && (
                    <TeamSelectionField
                      departmentId={selectedDepartment}
                      encounterType={admissionType}
                      value={selectedPrimaryTeam}
                      onChange={setSelectedPrimaryTeam}
                    />
                  )}

                  {admissionType === 'inpatient' && selectedDepartment && (
                    <>
                      <div className="flex items-center space-x-2 mb-2">
                        <input
                          type="checkbox"
                          id="waitingList"
                          checked={isWaitingList}
                          onChange={(e) => {
                            setIsWaitingList(e.target.checked);
                            if (e.target.checked) {
                              setSelectedWard("");
                              form.setValue("bed_id", "");
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <label htmlFor="waitingList" className="text-sm font-medium leading-none">
                          Add to waiting list (assign bed later)
                        </label>
                      </div>

                      {!isWaitingList && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormItem>
                            <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Ward</FormLabel>
                            <Select
                              onValueChange={(val) => {
                                setSelectedWard(val);
                                form.setValue('bed_id', '');
                              }}
                              value={selectedWard}
                            >
                              <SelectTrigger className="font-mono">
                                <SelectValue placeholder={isWardsLoading ? "Loading wards..." : "Select ward"} />
                              </SelectTrigger>
                              <SelectContent>
                                {(unitWards || []).map((ward) => (
                                  <SelectItem key={ward.id} value={ward.id}>
                                    {ward.name} ({ward.ward_type})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>

                          <FormField
                            control={form.control}
                            name="bed_id"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Bed</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} disabled={!selectedWard}>
                                  <SelectTrigger className="font-mono">
                                    <SelectValue placeholder={selectedWard ? "Select bed" : "Select ward first"} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {beds.map((bed) => (
                                      <SelectItem key={bed.id} value={bed.id}>
                                        {bed.bed_number} ({bed.bed_type}) - ${bed.total_rate}
                                      </SelectItem>
                                    ))}
                                    {selectedWard && beds.length === 0 && (
                                      <div className="p-2 text-sm text-muted-foreground">No available beds</div>
                                    )}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      )}
                    </>
                  )}
                </TabsContent>
              )}

              <TabsContent value="identity" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="first_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          First Name <span className="text-rose-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="First name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="last_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Last Name <span className="text-rose-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Last name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="date_of_birth"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Date of Birth {!isEditMode && <span className="text-rose-500">*</span>}
                        </FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant={"outline"}
                                className={cn(
                                  "w-full pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                              >
                                {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={field.onChange}
                              disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Email <span className="text-rose-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="Email address"
                            {...field}
                            disabled={!isEditMode && noEmail}
                          />
                        </FormControl>
                        {!isEditMode && (
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              id="noEmail"
                              type="checkbox"
                              checked={noEmail}
                              onChange={(e) => setNoEmail(e.target.checked)}
                              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                            />
                            <label htmlFor="noEmail" className="text-xs text-muted-foreground font-mono">
                              No email available (a placeholder will be generated)
                            </label>
                          </div>
                        )}
                        {noEmail && !isEditMode && (
                          <p className="text-xs text-muted-foreground font-mono">
                            Placeholder: <span className="font-medium">{generatedNoEmail}</span>
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="phone_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Phone Number {(noEmail && !isEditMode) || isRuleRequired('phone_number') ? <span className="text-rose-500">*</span> : null}
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Phone number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="nhis_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          NHIS ID {isRuleRequired('nhis_id') ? <span className="text-rose-500">*</span> : null}
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="NHIS ID" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {isEditMode && (
                  <FormField
                    control={form.control}
                    name="medical_record_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Medical Record Number</FormLabel>
                        <FormControl>
                          <Input placeholder="Medical record number" {...field} readOnly />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {!isEditMode && dobString && (
                  <div className="p-4 border border-border rounded-lg bg-muted/20">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <Search className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-medium">Possible duplicates</p>
                      </div>
                      {isMatchesLoading && (
                        <span className="text-xs text-muted-foreground font-mono">Searching...</span>
                      )}
                    </div>
                    {possibleMatches.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No matches found for this name and date of birth.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-amber-700 dark:text-amber-300 font-mono">
                          Verify before creating a new record.
                        </p>
                        {possibleMatches.map((match) => (
                          <div key={match.id} className="flex items-center justify-between gap-3 p-2 rounded-md border border-border bg-card/40">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{match.name}</p>
                              <p className="text-xs text-muted-foreground font-mono">
                                MRN {match.medical_record_number || 'N/A'} · DOB {match.date_of_birth}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="font-mono text-xs"
                              onClick={() => navigate(`/patients/${match.id}`)}
                            >
                              Open
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="contact" className="space-y-4 mt-4">
                <h3 className="font-display text-lg text-foreground">Address</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="address_line1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Address Line 1 {isRuleRequired('address_line1') ? <span className="text-rose-500">*</span> : null}
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Address line 1" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="address_line2"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Address Line 2 {isRuleRequired('address_line2') ? <span className="text-rose-500">*</span> : null}
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Address line 2" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          City {isRuleRequired('city') ? <span className="text-rose-500">*</span> : null}
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="City" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          State/Province {isRuleRequired('state') ? <span className="text-rose-500">*</span> : null}
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="State/Province" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="postal_code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Postal Code {isRuleRequired('postal_code') ? <span className="text-rose-500">*</span> : null}
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Postal code" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Country {isRuleRequired('country') ? <span className="text-rose-500">*</span> : null}
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Country" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator className="my-4" />
                <h3 className="font-display text-lg text-foreground">Emergency Contact</h3>

                <FormField
                  control={form.control}
                  name="emergency_contact_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        Emergency Contact Name {isRuleRequired('emergency_contact_name') ? <span className="text-rose-500">*</span> : null}
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Emergency contact name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="emergency_contact_phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        Emergency Contact Phone {isRuleRequired('emergency_contact_phone') ? <span className="text-rose-500">*</span> : null}
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Emergency contact phone" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="emergency_contact_relationship"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        Relationship {isRuleRequired('emergency_contact_relationship') ? <span className="text-rose-500">*</span> : null}
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Relationship to patient" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              {!isEditMode && (
                <TabsContent value="insurance" className="space-y-4 mt-4">
                  <div className="space-y-4">
                    <div className={cn(
                      "flex items-center justify-between p-4 rounded-lg border",
                      showValidation && insuranceData.hasInsurance && !validateInsuranceStep() ? "border-rose-200 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-900/10" : "border-border bg-muted/20"
                    )}>
                      <div className="flex items-center gap-3">
                        <Shield className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">Insurance Coverage</p>
                          <p className="text-xs text-muted-foreground">
                            Add insurance details for this patient
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {insuranceData.hasInsurance ? 'Enabled' : 'Skip'}
                        </span>
                        <input
                          type="checkbox"
                          checked={insuranceData.hasInsurance}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setInsuranceData(prev => ({
                              ...prev,
                              hasInsurance: checked,
                              ...(checked ? {} : {
                                plan: '',
                                policy_number: '',
                                valid_from: null,
                                valid_until: null,
                              })
                            }));
                            if (!checked) {
                              setSelectedProviderId('');
                            }
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                      </div>
                    </div>

                    {insuranceData.hasInsurance && (
                      <div className="space-y-4 p-4 border border-border rounded-lg">
                        <div className="space-y-2">
                          <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                            Insurance Provider <span className="text-rose-500">*</span>
                          </FormLabel>
                          <Select
                            value={selectedProviderId}
                            onValueChange={(value) => {
                              setSelectedProviderId(value);
                              setInsuranceData(prev => ({ ...prev, plan: '' }));
                            }}
                            disabled={!insuranceQueryEnabled}
                          >
                            <SelectTrigger className={cn("font-mono", showValidation && !selectedProviderId && "border-rose-500")}>
                              <SelectValue placeholder={insuranceQueryEnabled ? "Select provider" : "Loading providers..."} />
                            </SelectTrigger>
                            <SelectContent>
                              {providers.map((provider) => (
                                <SelectItem key={provider.id} value={provider.id}>
                                  {provider.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                            Insurance Plan <span className="text-rose-500">*</span>
                          </FormLabel>
                          <Select
                            value={insuranceData.plan}
                            onValueChange={(value) => setInsuranceData(prev => ({ ...prev, plan: value }))}
                            disabled={!selectedProviderId || !plansQueryEnabled}
                          >
                            <SelectTrigger className={cn("font-mono", showValidation && !insuranceData.plan && "border-rose-500")}>
                              <SelectValue placeholder={selectedProviderId ? "Select plan" : "Select provider first"} />
                            </SelectTrigger>
                            <SelectContent>
                              {plans.map((plan) => (
                                <SelectItem key={plan.id} value={plan.id}>
                                  {plan.name} ({plan.coverage_percentage}% coverage)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                            Policy Number <span className="text-rose-500">*</span>
                          </FormLabel>
                          <Input
                            value={insuranceData.policy_number}
                            onChange={(e) => setInsuranceData(prev => ({ ...prev, policy_number: e.target.value }))}
                            placeholder="e.g., POL-12345678"
                            className={cn(showValidation && !insuranceData.policy_number?.trim() && "border-rose-500")}
                          />
                        </div>

                        <div className="space-y-2">
                          <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                            Validity Period
                          </FormLabel>
                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <DatePicker
                                date={insuranceData.valid_from}
                                setDate={(date) => setInsuranceData(prev => ({ ...prev, valid_from: date }))}
                                placeholder="Start date"
                                className="w-full"
                              />
                            </div>
                            <span className="text-muted-foreground text-sm">to</span>
                            <div className="flex-1">
                              <DatePicker
                                date={insuranceData.valid_until}
                                setDate={(date) => setInsuranceData(prev => ({ ...prev, valid_until: date }))}
                                placeholder="No expiry"
                                className="w-full"
                              />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">Leave end date blank for no expiry</p>
                        </div>
                      </div>
                    )}

                    {!insuranceData.hasInsurance && (
                      <div className="text-center py-8 text-muted-foreground">
                        <Shield className="h-10 w-10 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">No insurance will be added</p>
                        <p className="text-xs mt-1">You can add insurance later from the patient's profile</p>
                      </div>
                    )}
                  </div>
                </TabsContent>
              )}

              <TabsContent value="review" className="space-y-4 mt-4">
                <div className="space-y-3">
                  {!isEditMode && (
                    <div className="p-4 rounded-lg border border-border bg-card/40">
                      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Encounter</p>
                      <p className="text-sm">
                        <span className="font-medium">Type:</span> {admissionType}
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Department:</span>{' '}
                        {departments.find((d) => d.id === selectedDepartment)?.name || (selectedDepartment ? 'Selected' : 'Not selected')}
                      </p>
                      {admissionType === 'outpatient' && selectedClinic && (
                        <p className="text-sm">
                          <span className="font-medium">Clinic:</span>{' '}
                          {activeClinicOptions.find((c) => c.id === selectedClinic)?.name || 'Selected'}
                        </p>
                      )}
                      {admissionType === 'inpatient' && (
                        <p className="text-sm">
                          <span className="font-medium">Ward:</span>{' '}
                          {selectedWard ? (unitWards.find((w) => w.id === selectedWard)?.name || 'Selected') : (isWaitingList ? 'Waiting list' : 'Not selected')}
                        </p>
                      )}
                      {encounterBlocksOutpatient && (
                        <p className="text-sm text-rose-600 dark:text-rose-400 font-mono mt-2">
                          Cannot register outpatient visit: no clinics are scheduled right now.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="p-4 rounded-lg border border-border bg-card/40">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Identity</p>
                    <p className="text-sm">
                      <span className="font-medium">Name:</span> {firstName} {lastName}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">DOB:</span> {dobString || 'Not set'}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Email:</span> {form.getValues('email') || 'Not set'}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Phone:</span> {form.getValues('phone_number') || 'Not set'}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">NHIS ID:</span> {form.getValues('nhis_id') || 'Not set'}
                    </p>
                  </div>

                  <div className="p-4 rounded-lg border border-border bg-card/40">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Contact</p>
                    <p className="text-sm">
                      <span className="font-medium">Address:</span> {[
                        form.getValues('address_line1'),
                        form.getValues('address_line2'),
                        form.getValues('city'),
                        form.getValues('state'),
                        form.getValues('postal_code'),
                        form.getValues('country'),
                      ].filter(Boolean).join(', ') || 'Not set'}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Emergency:</span> {[
                        form.getValues('emergency_contact_name'),
                        form.getValues('emergency_contact_relationship'),
                        form.getValues('emergency_contact_phone'),
                      ].filter(Boolean).join(' · ') || 'Not set'}
                    </p>
                  </div>

                  {!isEditMode && (
                    <div className="p-4 rounded-lg border border-border bg-card/40">
                      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Insurance</p>
                      {insuranceData.hasInsurance ? (
                        <>
                          <p className="text-sm">
                            <span className="font-medium">Provider:</span> {providers.find((p) => p.id === selectedProviderId)?.name || 'Selected'}
                          </p>
                          <p className="text-sm">
                            <span className="font-medium">Plan:</span> {plans.find((p) => p.id === insuranceData.plan)?.name || 'Selected'}
                          </p>
                          <p className="text-sm">
                            <span className="font-medium">Policy:</span> {insuranceData.policy_number || 'Not set'}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">No insurance will be added</p>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>

              <div className="flex items-center justify-between pt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBack}
                  disabled={isFirstStep || isSubmitting}
                  className="font-mono text-sm"
                >
                  Back
                </Button>

                {!isLastStep ? (
                  <Button
                    type="button"
                    onClick={handleNext}
                    disabled={isSubmitting || (!isEditMode && activeStep === 'encounter' && encounterBlocksOutpatient)}
                    className="font-mono text-sm bg-primary hover:bg-primary/90"
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={isSubmitting || (!isEditMode && encounterBlocksOutpatient)}
                    className="font-mono text-sm bg-primary hover:bg-primary/90"
                  >
                    {isSubmitting ? "Saving..." : isEditMode ? "Update Patient" : "Register Patient"}
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default PatientForm;
