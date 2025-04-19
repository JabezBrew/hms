import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import StaffForm from '@/components/staff/StaffForm';

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
    <div className="space-y-4">
      <div className="flex items-center">
        <button 
          className="text-sm text-muted-foreground hover:text-foreground flex items-center"
          onClick={() => navigate('/staff')}
        >
          ← Back to Staff List
        </button>
      </div>
      <div className="max-w-4xl mx-auto">
        <StaffForm 
          onSuccess={handleSuccess} 
        />
      </div>
    </div>
  );
};

export default StaffCreatePage;
