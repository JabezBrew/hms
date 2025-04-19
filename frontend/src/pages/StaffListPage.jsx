import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { staffApi } from '@/lib/api/staff';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PlusIcon, SearchIcon } from 'lucide-react';
import { toast } from 'sonner';

const StaffListPage = () => {
  const navigate = useNavigate();
  const [staff, setStaff] = useState([]);
  const [filteredStaff, setFilteredStaff] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchStaff = async () => {
      try {
        setIsLoading(true);
        // The API client now automatically handles paginated responses
        const staffData = await staffApi.getStaff();
        setStaff(staffData);
        setFilteredStaff(staffData);
      } catch (error) {
        toast.error('Failed to fetch staff members');
        console.error('Error fetching staff:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStaff();
  }, []);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredStaff(staff);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = staff.filter(
        (member) =>
          member.user_details?.first_name?.toLowerCase().includes(query) ||
          member.user_details?.last_name?.toLowerCase().includes(query) ||
          member.user_details?.email?.toLowerCase().includes(query) ||
          member.department?.toLowerCase().includes(query) ||
          member.position?.toLowerCase().includes(query) ||
          member.employee_id?.toLowerCase().includes(query)
      );
      setFilteredStaff(filtered);
    }
  }, [searchQuery, staff]);

  const handleCreateStaff = () => {
    navigate('/staff/create');
  };

  const handleViewStaff = (id) => {
    navigate(`/staff/${id}`);
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

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Staff Management</h1>
        <Button onClick={handleCreateStaff} className="ml-5">
          <PlusIcon className="h-4 w-4 mr-2" />
          Add Staff Member
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle>Staff Members</CardTitle>
            <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-64">
                <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search staff..."
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredStaff.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? 'No staff members found matching your search.' : 'No staff members found.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStaff.map((member) => (
                    <TableRow key={member.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleViewStaff(member.id)}>
                      <TableCell className="font-medium">{member.employee_id}</TableCell>
                      <TableCell>
                        {member.user_details?.first_name} {member.user_details?.last_name}
                      </TableCell>
                      <TableCell>{member.user_details?.email}</TableCell>
                      <TableCell>{member.department}</TableCell>
                      <TableCell>{member.position}</TableCell>
                      <TableCell>
                        <Badge className={getUserTypeBadgeColor(member.user_details?.user_type)}>
                          {formatUserType(member.user_details?.user_type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={(e) => {
                          e.stopPropagation();
                          handleViewStaff(member.id);
                        }}>
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StaffListPage;
