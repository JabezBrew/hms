import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import format from "date-fns/format";
import { useRegisterStaff } from "@/features/staff/hooks";
import { useClinicalUnits } from "@/features/admin/hooks";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  buildRegistrationPayload,
  defaultValues,
  isPractitionerUserType,
  staffFieldToStep,
  staffFormSchema,
  staffRoleLabels,
  staffRoleOptions,
  staffStepDefs,
  stepFieldsByKey,
} from './staffForm.utils';

const StaffForm = ({ onSuccess }) => {
  const registerStaffMutation = useRegisterStaff();
  const [isLoading, setIsLoading] = useState(false);
  const [showValidation, setShowValidation] = useState(false);

  const stepKeys = useMemo(() => staffStepDefs.map((step) => step.key), []);
  const [activeStep, setActiveStep] = useState(stepKeys[0]);

  const form = useForm({
    resolver: zodResolver(staffFormSchema),
    defaultValues,
  });

  const { data: departmentUnits = [], isLoading: isDepartmentsLoading } = useClinicalUnits({
    unit_type_code: 'department',
    is_active: true,
  });

  const departmentOptions = useMemo(() => (
    (Array.isArray(departmentUnits) ? departmentUnits : [])
      .filter((unit) => typeof unit?.id === 'string' && typeof unit?.name === 'string' && unit.name.trim())
      .map((unit) => ({
        id: unit.id,
        name: unit.name.trim(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  ), [departmentUnits]);

  const departmentNameById = useMemo(
    () => new Map(departmentOptions.map((department) => [department.id, department.name])),
    [departmentOptions]
  );

  const userType = form.watch('user_type');
  const dateOfBirth = form.watch('date_of_birth');
  const isPractitioner = isPractitionerUserType(userType);

  useEffect(() => {
    if (!stepKeys.includes(activeStep)) {
      setActiveStep(stepKeys[0]);
    }
  }, [activeStep, stepKeys]);

  useEffect(() => {
    if (!isPractitioner) {
      form.clearErrors(['license_number', 'specialization', 'qualification']);
    }
  }, [form, isPractitioner]);

  const currentStepIndex = stepKeys.indexOf(activeStep);
  const isFirstStep = currentStepIndex <= 0;
  const isLastStep = currentStepIndex === stepKeys.length - 1;
  const isSubmitting = isLoading || registerStaffMutation.isPending;

  const goToStep = useCallback((stepKey, focusField = null) => {
    setActiveStep(stepKey);
    if (focusField) {
      setTimeout(() => form.setFocus(focusField), 0);
    }
  }, [form]);

  const validateStep = useCallback(async (stepKey) => {
    const fields = stepFieldsByKey[stepKey] || [];
    if (!fields.length) return true;

    const fieldsToValidate = stepKey === 'credentials' && !isPractitioner
      ? fields.filter((field) => field === 'temporary_password')
      : fields;

    if (!fieldsToValidate.length) return true;

    return form.trigger(fieldsToValidate);
  }, [form, isPractitioner]);

  const goToFirstErrorStep = useCallback(() => {
    const errors = form.formState.errors || {};
    const errorFields = Object.keys(errors);

    const firstErrorByStep = new Map();
    for (const field of errorFields) {
      const step = staffFieldToStep[field];
      if (step && !firstErrorByStep.has(step)) {
        firstErrorByStep.set(step, field);
      }
    }

    for (const step of stepKeys) {
      const firstField = firstErrorByStep.get(step);
      if (firstField) {
        goToStep(step, firstField);
        return;
      }
    }
  }, [form.formState.errors, goToStep, stepKeys]);

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

  const submitRegistration = useCallback(async (values) => {
    setIsLoading(true);
    try {
      const payload = buildRegistrationPayload(values, {
        resolveDepartment: (departmentValue) => (
          departmentNameById.get(departmentValue) || departmentValue
        ),
      });
      const response = await registerStaffMutation.mutateAsync(payload);
      const responseData = response?.data !== undefined ? response.data : response;

      form.reset(defaultValues);
      setShowValidation(false);
      setActiveStep(stepKeys[0]);

      if (onSuccess) {
        onSuccess(responseData);
      }
    } catch (error) {
      toast.error(error.message || "Failed to register staff member");
    } finally {
      setIsLoading(false);
    }
  }, [departmentNameById, form, onSuccess, registerStaffMutation, stepKeys]);

  const onFormSubmit = useCallback(async (values) => {
    if (activeStep !== 'review') {
      await handleNext();
      return;
    }

    setShowValidation(true);
    for (const stepKey of stepKeys) {
      // Validate sequentially to avoid overlapping `form.trigger()` calls.
      const ok = await validateStep(stepKey);
      if (!ok) {
        goToFirstErrorStep();
        return;
      }
    }

    await submitRegistration(values);
  }, [activeStep, goToFirstErrorStep, handleNext, stepKeys, submitRegistration, validateStep]);

  const stepErrorCounts = useMemo(() => {
    const errors = form.formState.errors || {};
    const counts = Object.fromEntries(stepKeys.map((step) => [step, 0]));
    Object.keys(errors).forEach((field) => {
      const step = staffFieldToStep[field];
      if (step && counts[step] !== undefined) {
        counts[step] += 1;
      }
    });
    return counts;
  }, [form.formState.errors, stepKeys]);

  const hasFormErrors = Object.keys(form.formState.errors || {}).length > 0;

  return (
    <Card className="w-full border-border">
      <CardContent className="pt-6">
        {showValidation && hasFormErrors && (
          <Alert className="mb-6 border-amber-200 bg-amber-50/60 text-amber-950 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-100">
            <AlertCircle />
            <AlertTitle>Fix a few items to continue</AlertTitle>
            <AlertDescription>
              <div className="space-y-1">
                {Object.entries(form.formState.errors || {}).map(([field, err]) => {
                  const targetStep = staffFieldToStep[field];
                  return (
                    <button
                      key={field}
                      type="button"
                      className="text-left hover:underline font-mono text-xs"
                      onClick={() => {
                        if (targetStep) {
                          goToStep(targetStep, field);
                        } else {
                          goToFirstErrorStep();
                        }
                      }}
                    >
                      {String(err?.message || field)}
                    </button>
                  );
                })}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={activeStep} onValueChange={setActiveStep}>
          <div className="mb-6 rounded-lg border border-border/60 bg-muted/20 p-3 sm:hidden">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase text-muted-foreground">
                Step {currentStepIndex + 1} of {staffStepDefs.length}
              </p>
              {stepErrorCounts[activeStep] > 0 && (
                <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                  {stepErrorCounts[activeStep]}
                </Badge>
              )}
            </div>
            <p className="mt-1 font-heading text-sm font-semibold text-foreground">
              {staffStepDefs[currentStepIndex]?.label || 'Staff details'}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border/70">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${((currentStepIndex + 1) / staffStepDefs.length) * 100}%` }}
              />
            </div>
          </div>

          <TabsList className="mb-6 hidden w-full grid-cols-5 sm:grid">
            {staffStepDefs.map((step, idx) => {
              const count = stepErrorCounts[step.key] || 0;
              return (
                <TabsTrigger key={step.key} value={step.key} className="font-mono text-xs">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex size-5 items-center justify-center rounded-full border border-border bg-card text-[10px]">
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
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Email <span className="text-rose-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="Email address" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="phone_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Phone Number
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Phone number" {...field} />
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
                          Date of Birth <span className="text-rose-500">*</span>
                        </FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                              >
                                {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                <CalendarIcon className="ml-auto size-4 opacity-50" />
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
                    name="user_type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          User Type <span className="text-rose-500">*</span>
                        </FormLabel>
                        <Select
                          onValueChange={(value) => {
                            field.onChange(value);
                            if (!isPractitionerUserType(value)) {
                              form.setValue('license_number', '');
                              form.setValue('specialization', '');
                              form.setValue('qualification', '');
                              form.clearErrors(['license_number', 'specialization', 'qualification']);
                            }
                          }}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select user type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {staffRoleOptions.map((role) => (
                              <SelectItem key={role.value} value={role.value}>
                                {role.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              <TabsContent value="employment" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="employee_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Employee ID <span className="text-rose-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Employee ID" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="department"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Department <span className="text-rose-500">*</span>
                        </FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                          disabled={isDepartmentsLoading || !departmentOptions.length}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={
                                  isDepartmentsLoading
                                    ? "Loading departments..."
                                    : departmentOptions.length
                                      ? "Select department"
                                      : "No departments configured"
                                }
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {departmentOptions.map((department) => (
                              <SelectItem key={department.id} value={department.id}>
                                {department.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!isDepartmentsLoading && !departmentOptions.length ? (
                          <p className="text-[11px] font-mono text-amber-600">
                            Create a department under Organization first.
                          </p>
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="position"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Position <span className="text-rose-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Position" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="hire_date"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Hire Date <span className="text-rose-500">*</span>
                        </FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                              >
                                {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                <CalendarIcon className="ml-auto size-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={field.onChange}
                              disabled={(date) => (
                                date > new Date() ||
                                date < new Date("1900-01-01") ||
                                (dateOfBirth ? date < dateOfBirth : false)
                              )}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              <TabsContent value="credentials" className="space-y-4 mt-4">
                <div className="rounded-lg border border-border bg-card/40 p-4">
                  <FormField
                    control={form.control}
                    name="temporary_password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Temporary Password <span className="text-rose-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            autoComplete="new-password"
                            placeholder="Temporary password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {isPractitioner ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-muted/20 p-4">
                      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                        Practitioner credentials are required for {staffRoleLabels[userType]?.toLowerCase()} roles.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="license_number"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                              License Number <span className="text-rose-500">*</span>
                            </FormLabel>
                            <FormControl>
                              <Input placeholder="License number" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="specialization"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                              Specialization <span className="text-rose-500">*</span>
                            </FormLabel>
                            <FormControl>
                              <Input placeholder="Specialization" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="qualification"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                            Qualification <span className="text-rose-500">*</span>
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Qualification and training background"
                              className="min-h-[100px]"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ) : (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-900/10">
                    <div className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
                      <p className="text-sm text-emerald-800 dark:text-emerald-200 font-medium">
                        No practitioner credentials needed for this role.
                      </p>
                    </div>
                    <p className="text-xs text-emerald-700/90 dark:text-emerald-300 mt-2 font-mono">
                      Practitioner credentials are only required for doctors and nurses.
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="contact" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="address_line1"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Address Line 1
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
                      <FormItem className="md:col-span-2">
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Address Line 2
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
                          City
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
                          State/Province
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
                          Postal Code
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
                          Country
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Country" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              <TabsContent value="review" className="space-y-4 mt-4">
                <div className="space-y-3">
                  <div className="p-4 rounded-lg border border-border bg-card/40">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Identity</p>
                    <p className="text-sm">
                      <span className="font-medium">Name:</span> {form.getValues('first_name')} {form.getValues('last_name')}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Email:</span> {form.getValues('email') || 'Not set'}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Phone:</span> {form.getValues('phone_number') || 'Not set'}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">DOB:</span>{' '}
                      {form.getValues('date_of_birth') ? format(form.getValues('date_of_birth'), 'yyyy-MM-dd') : 'Not set'}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Role:</span> {staffRoleLabels[form.getValues('user_type')] || 'Not set'}
                    </p>
                  </div>

                  <div className="p-4 rounded-lg border border-border bg-card/40">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Employment</p>
                    <p className="text-sm">
                      <span className="font-medium">Employee ID:</span> {form.getValues('employee_id') || 'Not set'}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Department:</span>{' '}
                      {departmentNameById.get(form.getValues('department')) || form.getValues('department') || 'Not set'}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Position:</span> {form.getValues('position') || 'Not set'}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Hire Date:</span>{' '}
                      {form.getValues('hire_date') ? format(form.getValues('hire_date'), 'yyyy-MM-dd') : 'Not set'}
                    </p>
                  </div>

                  <div className="p-4 rounded-lg border border-border bg-card/40">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Credentials</p>
                    <p className="text-sm">
                      <span className="font-medium">Temporary Password:</span>{' '}
                      {form.getValues('temporary_password') ? 'Set' : 'Not set'}
                    </p>
                    {isPractitioner ? (
                      <>
                        <p className="text-sm">
                          <span className="font-medium">License:</span> {form.getValues('license_number') || 'Not set'}
                        </p>
                        <p className="text-sm">
                          <span className="font-medium">Specialization:</span> {form.getValues('specialization') || 'Not set'}
                        </p>
                        <p className="text-sm">
                          <span className="font-medium">Qualification:</span> {form.getValues('qualification') || 'Not set'}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">No practitioner credentials required for this role</p>
                    )}
                  </div>

                  <div className="p-4 rounded-lg border border-border bg-card/40">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Contact</p>
                    <p className="text-sm">
                      <span className="font-medium">Address:</span>{' '}
                      {[
                        form.getValues('address_line1'),
                        form.getValues('address_line2'),
                        form.getValues('city'),
                        form.getValues('state'),
                        form.getValues('postal_code'),
                        form.getValues('country'),
                      ].filter(Boolean).join(', ') || 'Not set'}
                    </p>
                  </div>
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
                    disabled={isSubmitting}
                    className="font-mono text-sm bg-primary hover:bg-primary/90"
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="font-mono text-sm bg-primary hover:bg-primary/90"
                  >
                    {isSubmitting ? "Saving..." : "Create Staff Member"}
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

export default StaffForm;
