import format from "date-fns/format";
import * as z from "zod";

export const staffRoleOptions = [
  { value: 'admin', label: 'Administrator' },
  { value: 'doctor', label: 'Doctor' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'lab_technician', label: 'Lab Technician' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'billing', label: 'Billing Clerk' },
];

export const staffRoleLabels = Object.fromEntries(
  staffRoleOptions.map((option) => [option.value, option.label])
);

const staffRoleValues = staffRoleOptions.map((option) => option.value);

export const staffStepDefs = [
  { key: 'identity', label: 'Identity' },
  { key: 'employment', label: 'Employment' },
  { key: 'credentials', label: 'Credentials' },
  { key: 'contact', label: 'Contact' },
  { key: 'review', label: 'Review' },
];

export const staffFieldToStep = {
  first_name: 'identity',
  last_name: 'identity',
  email: 'identity',
  phone_number: 'identity',
  date_of_birth: 'identity',
  user_type: 'identity',
  department: 'employment',
  position: 'employment',
  hire_date: 'employment',
  license_number: 'credentials',
  specialization: 'credentials',
  qualification: 'credentials',
  address_line1: 'contact',
  address_line2: 'contact',
  city: 'contact',
  state: 'contact',
  postal_code: 'contact',
  country: 'contact',
};

export const stepFieldsByKey = {
  identity: ['first_name', 'last_name', 'email', 'phone_number', 'date_of_birth', 'user_type'],
  employment: ['department', 'position', 'hire_date'],
  credentials: ['license_number', 'specialization', 'qualification'],
  contact: ['address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country'],
  review: [],
};

export const isPractitionerUserType = (userType) => userType === 'doctor' || userType === 'nurse';

export const staffStepDefsForRole = (userType) => (
  staffStepDefs.filter((step) => step.key !== 'credentials' || isPractitionerUserType(userType))
);

export const staffFormSchema = z.object({
  email: z.string().trim().email({ message: "Please enter a valid email address" }),
  first_name: z.string().trim().min(1, { message: "First name is required" }),
  last_name: z.string().trim().min(1, { message: "Last name is required" }),
  phone_number: z.string().trim().optional(),
  date_of_birth: z.date({ required_error: "Date of birth is required" }),
  user_type: z.enum(staffRoleValues, { required_error: "Please select a user type" }),
  department: z.string().trim().min(1, { message: "Department is required" }),
  position: z.string().trim().min(1, { message: "Position is required" }),
  hire_date: z.date({ required_error: "Hire date is required" }),
  license_number: z.string().trim().optional(),
  specialization: z.string().trim().optional(),
  qualification: z.string().trim().optional(),
  address_line1: z.string().trim().optional(),
  address_line2: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  postal_code: z.string().trim().optional(),
  country: z.string().trim().optional(),
}).superRefine((data, ctx) => {
  const today = new Date();
  const minDate = new Date("1900-01-01");

  if (data.date_of_birth) {
    if (data.date_of_birth > today) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Date of birth cannot be in the future",
        path: ['date_of_birth'],
      });
    }
    if (data.date_of_birth < minDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Date of birth is out of allowed range",
        path: ['date_of_birth'],
      });
    }
  }

  if (data.hire_date) {
    if (data.hire_date > today) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hire date cannot be in the future",
        path: ['hire_date'],
      });
    }
    if (data.hire_date < minDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hire date is out of allowed range",
        path: ['hire_date'],
      });
    }
  }

  if (data.date_of_birth && data.hire_date && data.hire_date < data.date_of_birth) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Hire date cannot be earlier than date of birth",
      path: ['hire_date'],
    });
  }

  if (isPractitionerUserType(data.user_type)) {
    if (!data.license_number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "License number is required for doctors and nurses",
        path: ['license_number'],
      });
    }
    if (!data.specialization) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Specialization is required for doctors and nurses",
        path: ['specialization'],
      });
    }
    if (!data.qualification) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Qualification is required for doctors and nurses",
        path: ['qualification'],
      });
    }
  }
});

export const defaultValues = {
  email: "",
  first_name: "",
  last_name: "",
  phone_number: "",
  date_of_birth: undefined,
  user_type: undefined,
  department: "",
  position: "",
  hire_date: undefined,
  license_number: "",
  specialization: "",
  qualification: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "",
};

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : value);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value) => UUID_RE.test(String(value || '').trim());

export const buildRegistrationPayload = (values, options = {}) => {
  const resolveDepartment = options.resolveDepartment || ((value) => value);
  const selectedDepartmentValue = normalizeText(values.department);
  const resolvedDepartment = resolveDepartment(values.department);
  const payload = {
    email: normalizeText(values.email)?.toLowerCase(),
    first_name: normalizeText(values.first_name),
    last_name: normalizeText(values.last_name),
    phone_number: normalizeText(values.phone_number) || '',
    date_of_birth: format(values.date_of_birth, 'yyyy-MM-dd'),
    user_type: values.user_type,
    department: normalizeText(resolvedDepartment),
    position: normalizeText(values.position),
    hire_date: format(values.hire_date, 'yyyy-MM-dd'),
    address_line1: normalizeText(values.address_line1) || '',
    address_line2: normalizeText(values.address_line2) || '',
    city: normalizeText(values.city) || '',
    state: normalizeText(values.state) || '',
    postal_code: normalizeText(values.postal_code) || '',
    country: normalizeText(values.country) || '',
  };

  if (isUuid(selectedDepartmentValue)) {
    payload.department_unit_id = selectedDepartmentValue;
  }

  if (isPractitionerUserType(values.user_type)) {
    payload.license_number = normalizeText(values.license_number);
    payload.specialization = normalizeText(values.specialization);
    payload.qualification = normalizeText(values.qualification);
  }

  return payload;
};
