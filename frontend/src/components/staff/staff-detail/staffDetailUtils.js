import Building from 'lucide-react/dist/esm/icons/building.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import Receipt from 'lucide-react/dist/esm/icons/receipt.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import format from 'date-fns/format';
import * as z from 'zod';

export const staffSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email'),
  phone_number: z.string().optional(),
  department: z.string().optional(),
  position: z.string().optional(),
  hire_date: z.date().optional().nullable(),
  license_number: z.string().optional(),
  specialization: z.string().optional(),
  qualification: z.string().optional(),
});

export const STAFF_DETAIL_DEFAULT_VALUES = {
  first_name: '',
  last_name: '',
  email: '',
  phone_number: '',
  department: '',
  position: '',
  hire_date: null,
  license_number: '',
  specialization: '',
  qualification: '',
};

const PRACTITIONER_USER_TYPES = new Set([
  'doctor',
  'nurse',
  'lab_technician',
  'pharmacist',
]);

const getRoleConfig = (type) => {
  const configs = {
    admin: {
      label: 'Administrator',
      icon: Shield,
      badgeClass: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
      description: 'System administrator with full access',
    },
    doctor: {
      label: 'Physician',
      icon: Stethoscope,
      badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
      description: 'Medical practitioner providing patient care',
    },
    nurse: {
      label: 'Nurse',
      icon: ClipboardList,
      badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
      description: 'Nursing professional providing patient care',
    },
    receptionist: {
      label: 'Receptionist',
      icon: Building,
      badgeClass: 'bg-violet-500/10 text-violet-600 border-violet-500/30',
      description: 'Front desk staff managing patient intake',
    },
    lab_technician: {
      label: 'Lab Technician',
      icon: FlaskConical,
      badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
      description: 'Laboratory specialist processing tests',
    },
    pharmacist: {
      label: 'Pharmacist',
      icon: Pill,
      badgeClass: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30',
      description: 'Pharmacy professional dispensing medications',
    },
    billing: {
      label: 'Billing Clerk',
      icon: Receipt,
      badgeClass: 'bg-pink-500/10 text-pink-600 border-pink-500/30',
      description: 'Finance staff handling billing and claims',
    },
  };

  return configs[type] || {
    label: 'Staff',
    icon: Building,
    badgeClass: 'bg-muted text-muted-foreground border-border',
    description: 'Staff member',
  };
};

export const getStaffEditValues = (staff, practitioner) => {
  if (!staff) return STAFF_DETAIL_DEFAULT_VALUES;

  return {
    first_name: staff.user_details?.first_name || '',
    last_name: staff.user_details?.last_name || '',
    email: staff.user_details?.email || '',
    phone_number: staff.user_details?.phone_number || '',
    department: staff.department || '',
    position: staff.position || '',
    hire_date: staff.hire_date ? new Date(staff.hire_date) : null,
    license_number: practitioner?.license_number || '',
    specialization: practitioner?.specialization || '',
    qualification: practitioner?.qualification || '',
  };
};

const calculateTenure = (hireDate) => {
  if (!hireDate) return null;

  try {
    const start = new Date(hireDate);
    const end = new Date();
    if (start > end) return '0 days';

    let years = end.getFullYear() - start.getFullYear();
    let months = end.getMonth() - start.getMonth();
    let days = end.getDate() - start.getDate();

    if (days < 0) {
      months -= 1;
      const prevMonth = new Date(end.getFullYear(), end.getMonth(), 0);
      days += prevMonth.getDate();
    }

    if (months < 0) {
      years -= 1;
      months += 12;
    }

    if (years > 0) {
      return months > 0
        ? `${years} ${years === 1 ? 'year' : 'years'} ${months} ${months === 1 ? 'month' : 'months'}`
        : `${years} ${years === 1 ? 'year' : 'years'}`;
    }

    if (months > 0) {
      return `${months} ${months === 1 ? 'month' : 'months'}`;
    }

    return `${days} ${days === 1 ? 'day' : 'days'}`;
  } catch {
    return null;
  }
};

export const getStaffViewModel = (staff, practitioner) => {
  const userType = staff.user_details?.user_type || '';
  const firstName = staff.user_details?.first_name || '';
  const lastName = staff.user_details?.last_name || '';
  const roleConfig = getRoleConfig(userType);

  return {
    userType,
    fullName: `${firstName} ${lastName}`.trim() || 'Unknown Staff',
    email: staff.user_details?.email || null,
    phone: staff.user_details?.phone_number || null,
    isActive: staff.user_details?.is_active !== false,
    employeeId: staff.employee_id || 'N/A',
    department: staff.department || null,
    position: staff.position || null,
    hireDate: staff.hire_date ? format(new Date(staff.hire_date), 'MMMM d, yyyy') : null,
    tenure: calculateTenure(staff.hire_date),
    isPractitioner: PRACTITIONER_USER_TYPES.has(userType),
    roleConfig,
    practitionerId: practitioner?.id,
  };
};
