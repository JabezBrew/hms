import { useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ArrowLeft, Edit, Trash2, Calendar, Mail, Phone, Building, Briefcase, Award, FileText, User, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { staffApi } from '@/lib/api/staff';

const StaffDetail = ({ staff, practitioner, onBack, onEdit, onDeleted }) => {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!staff) return null;

  const userType = staff.user_details?.user_type || '';
  const fullName = `${staff.user_details?.first_name || ''} ${staff.user_details?.last_name || ''}`.trim();
  const initials = fullName
    .split(' ')
    .map(name => name[0])
    .join('')
    .toUpperCase();

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await staffApi.deleteStaff(staff.id);
      toast.success('Staff member deleted successfully');
      if (onDeleted) onDeleted();
    } catch (error) {
      toast.error('Failed to delete staff member');
      console.error('Error deleting staff:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Function to get user type badge color
  const getUserTypeBadgeColor = (userType) => {
    switch (userType) {
      case 'admin':
        return 'bg-red-100 text-red-800';
      case 'doctor':
        return 'bg-blue-100 text-blue-800';
      case 'nurse':
        return 'bg-green-100 text-green-800';
      case 'receptionist':
        return 'bg-purple-100 text-purple-800';
      case 'lab_technician':
        return 'bg-yellow-100 text-yellow-800';
      case 'pharmacist':
        return 'bg-indigo-100 text-indigo-800';
      case 'billing':
        return 'bg-pink-100 text-pink-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Function to format user type for display
  const formatUserType = (userType) => {
    if (!userType) return '';
    return userType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Render different content based on user type
  const renderRoleSpecificContent = () => {
    switch (userType) {
      case 'doctor':
      case 'nurse':
      case 'lab_technician':
      case 'pharmacist':
        return renderPractitionerContent();
      case 'receptionist':
        return renderReceptionistContent();
      case 'billing':
        return renderBillingClerkContent();
      case 'admin':
        return renderAdminContent();
      default:
        return null;
    }
  };

  // Practitioner-specific content (doctor, nurse, lab tech, pharmacist)
  const renderPractitionerContent = () => {
    if (!practitioner) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Professional Information</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">No professional information available.</p>
          </CardContent>
        </Card>
      );
    }

    // Calculate years of experience based on hire date
    const calculateYearsOfExperience = () => {
      if (!staff.hire_date) return 'N/A';
      const hireDate = new Date(staff.hire_date);
      const today = new Date();
      let years = today.getFullYear() - hireDate.getFullYear();
      const m = today.getMonth() - hireDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < hireDate.getDate())) {
        years--;
      }
      return `${years} ${years === 1 ? 'year' : 'years'}`;
    };

    return (
      <Card>
        <CardHeader>
          <CardTitle>Professional Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center">
              <FileText className="h-5 w-5 mr-2 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">License Number</p>
                <p className="text-sm text-muted-foreground">{practitioner.license_number || 'N/A'}</p>
              </div>
            </div>
            <div className="flex items-center">
              <Award className="h-5 w-5 mr-2 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Specialization</p>
                <p className="text-sm text-muted-foreground">{practitioner.specialization || 'N/A'}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center">
              <Clock className="h-5 w-5 mr-2 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Years of Experience</p>
                <p className="text-sm text-muted-foreground">{calculateYearsOfExperience()}</p>
              </div>
            </div>
            <div className="flex items-center">
              <Award className="h-5 w-5 mr-2 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Certifications</p>
                <p className="text-sm text-muted-foreground">ACLS, BLS (placeholder)</p>
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Qualifications</p>
            <p className="text-sm text-muted-foreground">{practitioner.qualification || 'N/A'}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center">
              <Calendar className="h-5 w-5 mr-2 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Shift Schedule</p>
                <p className="text-sm text-muted-foreground">Regular (8am-5pm)</p>
              </div>
            </div>
            {practitioner.fhir_practitioner_id && (
              <div className="flex items-center">
                <FileText className="h-5 w-5 mr-2 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">FHIR Practitioner ID</p>
                  <p className="text-sm text-muted-foreground">{practitioner.fhir_practitioner_id}</p>
                </div>
              </div>
            )}
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Recent Activities</p>
            <div className="text-sm text-muted-foreground mt-2 border rounded-md p-2">
              <p className="py-1">• Patient consultation - John Doe (2 hours ago)</p>
              <p className="py-1">• Prescription issued - Jane Smith (Yesterday)</p>
              <p className="py-1">• Lab results reviewed - Mike Johnson (2 days ago)</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // Receptionist-specific content
  const renderReceptionistContent = () => {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Receptionist Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center">
              <Building className="h-5 w-5 mr-2 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Assigned Front Desk / Unit</p>
                <p className="text-sm text-muted-foreground">{staff.department || 'Main Reception'}</p>
              </div>
            </div>
            <div className="flex items-center">
              <User className="h-5 w-5 mr-2 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Patients Registered</p>
                <p className="text-sm text-muted-foreground">Statistics not available</p>
              </div>
            </div>
          </div>
          <div className="flex items-center">
            <Calendar className="h-5 w-5 mr-2 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Appointments Created</p>
              <p className="text-sm text-muted-foreground">Statistics not available</p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Recent Activity Log</p>
            <div className="text-sm text-muted-foreground mt-2 border rounded-md p-2">
              <p className="py-1">• Patient registered - Sarah Johnson (1 hour ago)</p>
              <p className="py-1">• Appointment scheduled - Robert Smith (3 hours ago)</p>
              <p className="py-1">• Patient check-in - David Williams (Yesterday)</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // Billing clerk-specific content
  const renderBillingClerkContent = () => {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Billing Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center">
              <FileText className="h-5 w-5 mr-2 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Invoices Generated</p>
                <p className="text-sm text-muted-foreground">Statistics not available</p>
              </div>
            </div>
            <div className="flex items-center">
              <FileText className="h-5 w-5 mr-2 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Claims Processed</p>
                <p className="text-sm text-muted-foreground">Statistics not available</p>
              </div>
            </div>
          </div>
          <div className="flex items-center">
            <FileText className="h-5 w-5 mr-2 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Revenue Handled</p>
              <p className="text-sm text-muted-foreground">Statistics not available</p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Last Billing Actions</p>
            <div className="text-sm text-muted-foreground mt-2 border rounded-md p-2">
              <p className="py-1">• Invoice #INV-2023-0042 issued - $450.00 (Today)</p>
              <p className="py-1">• Payment received - $320.75 from Patient ID #PT-2023-0089 (Yesterday)</p>
              <p className="py-1">• Insurance claim submitted - $1,250.00 for Patient ID #PT-2023-0076 (2 days ago)</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // Admin-specific content
  const renderAdminContent = () => {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Administrative Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center">
              <User className="h-5 w-5 mr-2 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">System Roles Managed</p>
                <p className="text-sm text-muted-foreground">All staff types</p>
              </div>
            </div>
            <div className="flex items-center">
              <FileText className="h-5 w-5 mr-2 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Access Scope</p>
                <p className="text-sm text-muted-foreground">Full system access</p>
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Logs of Key Actions</p>
            <div className="text-sm text-muted-foreground mt-2 border rounded-md p-2">
              <p className="py-1">• Created new staff account - Dr. Emily Chen (Today)</p>
              <p className="py-1">• Modified user permissions - James Wilson (Yesterday)</p>
              <p className="py-1">• System configuration updated - Billing module settings (3 days ago)</p>
              <p className="py-1">• User account deactivated - Former staff member (1 week ago)</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <div className="flex flex-col">
            <Button variant="outline" size="sm" className="mb-2 w-fit" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Staff List
            </Button>
            <div className="flex items-center pl-0">
              <Avatar className="h-12 w-12 mr-4">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div>
                <h2 className="text-2xl font-bold">{fullName}</h2>
                <div className="flex items-center">
                  <Badge className={getUserTypeBadgeColor(userType)}>
                    {formatUserType(userType)}
                  </Badge>
                  <span className="ml-2 text-sm text-muted-foreground">
                    ID: {staff.employee_id}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the staff member
                  and remove their data from the system.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Personal Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Full Name</span>
                    <span className="text-sm text-muted-foreground">{fullName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Email</span>
                    <span className="text-sm text-muted-foreground">{staff.user_details?.email || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Phone</span>
                    <span className="text-sm text-muted-foreground">{staff.user_details?.phone_number || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Date of Birth</span>
                    <span className="text-sm text-muted-foreground">
                      {staff.user_details?.date_of_birth 
                        ? format(new Date(staff.user_details.date_of_birth), 'PPP')
                        : 'N/A'}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>Employment Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Employee ID</span>
                    <span className="text-sm text-muted-foreground">{staff.employee_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Department</span>
                    <span className="text-sm text-muted-foreground">{staff.department}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Position</span>
                    <span className="text-sm text-muted-foreground">{staff.position}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Hire Date</span>
                    <span className="text-sm text-muted-foreground">
                      {staff.hire_date ? format(new Date(staff.hire_date), 'PPP') : 'N/A'}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {renderRoleSpecificContent()}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Contact Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center">
                  <Mail className="h-5 w-5 mr-2 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Email</p>
                    <p className="text-sm text-muted-foreground">{staff.user_details?.email || 'N/A'}</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <Phone className="h-5 w-5 mr-2 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Phone</p>
                    <p className="text-sm text-muted-foreground">{staff.user_details?.phone_number || 'N/A'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="details" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>System Account Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center">
                    <User className="h-5 w-5 mr-2 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Username / Email</p>
                      <p className="text-sm text-muted-foreground">{staff.user_details?.email || 'N/A'}</p>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <Clock className="h-5 w-5 mr-2 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Account Created</p>
                      <p className="text-sm text-muted-foreground">
                        {staff.user_details?.date_joined 
                          ? format(new Date(staff.user_details.date_joined), 'PPP')
                          : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center">
                    <Clock className="h-5 w-5 mr-2 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Last Login Time</p>
                      <p className="text-sm text-muted-foreground">Today, 09:45 AM</p>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <Badge variant="outline" className="mr-2">
                      Disabled
                    </Badge>
                    <div>
                      <p className="text-sm font-medium">Two-Factor Authentication</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center">
                    <Badge variant={staff.user_details?.is_active ? "success" : "destructive"} className="mr-2">
                      {staff.user_details?.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                    <div>
                      <p className="text-sm font-medium">Account Status</p>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <Briefcase className="h-5 w-5 mr-2 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Role</p>
                      <p className="text-sm text-muted-foreground">{formatUserType(userType)}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Additional role-specific details could be added here */}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default StaffDetail;
