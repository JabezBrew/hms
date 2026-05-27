import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import format from 'date-fns/format';
import { toast } from 'sonner';

import { Form } from '@/components/ui/form';
import { staffApi } from '@/features/staff/api';
import {
  staffKeys,
  useReactivateStaff,
  useResendStaffSetupLink,
  useUpdateStaff,
} from '@/features/staff/hooks';
import { PageShell } from '@/shared/components/page/PageShell';

import { StaffContactSection } from './staff-detail/StaffContactSection';
import { StaffDetailHeader } from './staff-detail/StaffDetailHeader';
import { StaffEmploymentSection } from './staff-detail/StaffEmploymentSection';
import { StaffProfessionalSection } from './staff-detail/StaffProfessionalSection';
import { StaffQuickActions } from './staff-detail/StaffQuickActions';
import { StaffReadonlySections } from './staff-detail/StaffReadonlySections';
import {
  STAFF_DETAIL_DEFAULT_VALUES,
  getStaffEditValues,
  getStaffViewModel,
  staffSchema,
} from './staff-detail/staffDetailUtils';

const StaffDetail = ({ staff, practitioner, onBack, onDeleted }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const updateMutation = useUpdateStaff();
  const reactivateMutation = useReactivateStaff();
  const resendSetupLinkMutation = useResendStaffSetupLink();

  const editValues = useMemo(
    () => getStaffEditValues(staff, practitioner),
    [staff, practitioner]
  );

  const form = useForm({
    resolver: zodResolver(staffSchema),
    defaultValues: STAFF_DETAIL_DEFAULT_VALUES,
    values: editValues,
  });

  const view = useMemo(
    () => (staff ? getStaffViewModel(staff, practitioner) : null),
    [staff, practitioner]
  );

  if (!staff || !view) return null;

  const onSubmit = async (data) => {
    try {
      const updateData = {
        user_details: {
          first_name: data.first_name,
          last_name: data.last_name,
          email: data.email,
          phone_number: data.phone_number || undefined,
        },
        department: data.department || undefined,
        position: data.position || undefined,
        hire_date: data.hire_date ? format(data.hire_date, 'yyyy-MM-dd') : undefined,
      };

      await updateMutation.mutateAsync({ id: staff.id, data: updateData });

      queryClient.invalidateQueries({ queryKey: staffKeys.detail(staff.id) });
      toast.success('Staff information updated');
      setIsEditing(false);
    } catch (err) {
      toast.error(err.message || 'Failed to update staff');
    }
  };

  const handleCancelEdit = () => {
    form.reset(editValues);
    setIsEditing(false);
  };

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await staffApi.deleteStaff(staff.id);
      toast.success('Staff account deactivated');
      if (onDeleted) onDeleted();
    } catch {
      toast.error('Failed to deactivate staff account');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReactivate = async () => {
    try {
      const response = await reactivateMutation.mutateAsync(staff.id);
      const mode = response?.mode;
      queryClient.invalidateQueries({ queryKey: staffKeys.detail(staff.id) });
      queryClient.invalidateQueries({ queryKey: staffKeys.lists() });

      if (mode === 'account_setup') {
        toast.success('Staff reactivated and account setup link sent');
        return;
      }
      if (mode === 'password_reset') {
        toast.success('Staff reactivated and password reset link sent');
        return;
      }
      toast.success(response?.detail || 'Staff account reactivated');
    } catch (error) {
      toast.error(error.message || 'Failed to reactivate staff account');
    }
  };

  const handleResetPassword = async () => {
    if (!staff.id) {
      toast.error('Cannot reset password: Staff information not available');
      return;
    }
    try {
      setIsResettingPassword(true);
      await resendSetupLinkMutation.mutateAsync(staff.id);
      toast.success('Password reset email sent successfully');
    } catch (error) {
      toast.error(error.message || 'Failed to reset password');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleResendSetupLink = async () => {
    if (!staff.id) {
      toast.error('Cannot resend setup link: Staff information not available');
      return;
    }
    try {
      const response = await resendSetupLinkMutation.mutateAsync(staff.id);
      const mode = response?.mode;
      if (mode === 'account_setup') {
        toast.success('Account setup link sent successfully');
        return;
      }
      if (mode === 'password_reset') {
        toast.success('Password reset link sent successfully');
        return;
      }
      toast.success(response?.detail || 'Setup link sent successfully');
    } catch (error) {
      toast.error(error.message || 'Failed to resend setup link');
    }
  };

  const handleManageSchedule = () => {
    if (practitioner?.id) {
      navigate('/practitioner-availability', {
        state: { practitionerId: String(practitioner.id) },
      });
      return;
    }
    navigate('/practitioner-availability');
  };

  const handleEdit = () => setIsEditing(true);

  return (
    <PageShell>
      <StaffDetailHeader
        view={view}
        state={{
          isEditing,
          isDeleting,
          isSaving: updateMutation.isPending,
          isReactivating: reactivateMutation.isPending,
        }}
        onBack={onBack}
        onCancelEdit={handleCancelEdit}
        onEdit={handleEdit}
        onSave={form.handleSubmit(onSubmit)}
        onDelete={handleDelete}
        onReactivate={handleReactivate}
      />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <Form {...form}>
          <StaffEmploymentSection form={form} isEditing={isEditing} view={view} />
          <StaffContactSection form={form} isEditing={isEditing} view={view} />
          <StaffProfessionalSection
            form={form}
            isEditing={isEditing}
            view={view}
            practitioner={practitioner}
            onManageSchedule={handleManageSchedule}
          />
        </Form>

        {!isEditing ? (
          <>
            <StaffReadonlySections staff={staff} view={view} />
            <StaffQuickActions
              view={view}
              isResettingPassword={isResettingPassword}
              isResendingSetupLink={resendSetupLinkMutation.isPending}
              isReactivating={reactivateMutation.isPending}
              onEdit={handleEdit}
              onManageSchedule={handleManageSchedule}
              onReactivate={handleReactivate}
              onResetPassword={handleResetPassword}
              onResendSetupLink={handleResendSetupLink}
            />
          </>
        ) : null}
      </main>
    </PageShell>
  );
};

export default StaffDetail;
