import format from 'date-fns/format';

import { TabsContent } from '@/components/ui/tabs';

import { staffRoleLabels } from '../staffForm.utils';

const getAddressSummary = (form) => (
  [
    form.getValues('address_line1'),
    form.getValues('address_line2'),
    form.getValues('city'),
    form.getValues('state'),
    form.getValues('postal_code'),
    form.getValues('country'),
  ].filter(Boolean).join(', ') || 'Not set'
);

export function StaffReviewStep({ form, departmentNameById, isPractitioner }) {
  const dateOfBirth = form.getValues('date_of_birth');
  const hireDate = form.getValues('hire_date');

  return (
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
            {dateOfBirth ? format(dateOfBirth, 'yyyy-MM-dd') : 'Not set'}
          </p>
          <p className="text-sm">
            <span className="font-medium">Role:</span> {staffRoleLabels[form.getValues('user_type')] || 'Not set'}
          </p>
        </div>

        <div className="p-4 rounded-lg border border-border bg-card/40">
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Employment</p>
          <p className="text-sm">
            <span className="font-medium">Department:</span>{' '}
            {departmentNameById.get(form.getValues('department')) || form.getValues('department') || 'Not set'}
          </p>
          <p className="text-sm">
            <span className="font-medium">Position:</span> {form.getValues('position') || 'Not set'}
          </p>
          <p className="text-sm">
            <span className="font-medium">Hire Date:</span>{' '}
            {hireDate ? format(hireDate, 'yyyy-MM-dd') : 'Not set'}
          </p>
        </div>

        {isPractitioner ? (
          <div className="p-4 rounded-lg border border-border bg-card/40">
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Credentials</p>
            <p className="text-sm">
              <span className="font-medium">License:</span> {form.getValues('license_number') || 'Not set'}
            </p>
            <p className="text-sm">
              <span className="font-medium">Specialization:</span> {form.getValues('specialization') || 'Not set'}
            </p>
            <p className="text-sm">
              <span className="font-medium">Qualification:</span> {form.getValues('qualification') || 'Not set'}
            </p>
          </div>
        ) : null}

        <div className="p-4 rounded-lg border border-border bg-card/40">
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Contact</p>
          <p className="text-sm">
            <span className="font-medium">Address:</span> {getAddressSummary(form)}
          </p>
        </div>
      </div>
    </TabsContent>
  );
}
