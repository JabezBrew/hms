import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import StaffForm from '@/components/staff/StaffForm';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

const StaffCreatePage = () => {
  const navigate = useNavigate();

  // Function to get staff ID from the response
  const getStaffId = (staff) => {
    if (staff?.id) {
      return staff.id;
    } else if (staff?.staff_details?.id) {
      return staff.staff_details.id;
    }
    return null;
  };

  const handleSuccess = (newStaff) => {
    toast.success('Staff member created successfully');
    // Get the staff ID from the response
    const staffId = getStaffId(newStaff);
    if (staffId) {
      // Navigate to the staff detail page
      navigate(`/staff/${staffId}`);
    } else {
      // Fallback to staff list if ID is not available
      navigate('/staff');
    }
  };

  const pageMeta = usePageMeta({
    title: 'Add Staff Member | Hospital Management System',
    breadcrumbs: [
      { label: 'Staff', path: '/staff' },
      { label: 'Add Staff Member' },
    ],
  });

  return (
    <PageShell>
      {pageMeta}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-4xl mx-auto p-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/staff')}
            className="mb-4 -ml-2 font-mono text-xs"
          >
            <ChevronLeft className="size-4 mr-1" />
            Back to Staff Directory
          </Button>

          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <UserPlus className="size-6 text-primary" />
            </div>
            <PageHeader
              title="Add Staff Member"
              description="Capture identity, role assignment, credentials, and contact details"
              size="md"
              wrap={false}
              className="border-none bg-transparent p-0"
              contentClassName="items-start"
              titleClassName="text-3xl md:text-4xl"
              descriptionClassName="mt-1 font-mono text-sm"
            />
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <StaffForm onSuccess={handleSuccess} />
      </div>
    </PageShell>
  );
};

export default StaffCreatePage;
