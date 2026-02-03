import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import StaffForm from '@/components/staff/StaffForm';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';

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

  return (
    <PageShell>
      <PageHeader
        title="Add Staff Member"
        description="Create a new staff profile"
        contentClassName="max-w-4xl mx-auto w-full"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/staff')}
          className="-ml-2 font-mono text-xs"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Staff List
        </Button>
      </PageHeader>

      <div className="p-4 sm:p-6">
        <div className="max-w-4xl mx-auto">
          <StaffForm onSuccess={handleSuccess} />
        </div>
      </div>
    </PageShell>
  );
};

export default StaffCreatePage;
