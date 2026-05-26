import PlusCircle from 'lucide-react/dist/esm/icons/circle-plus.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  useAppointmentTypes,
  useCreateAppointmentType,
  useUpdateAppointmentType,
  useDeleteAppointmentType
} from '@/features/appointments/hooks/useAppointmentQueries';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

/**
 * Component for managing appointment types
 */
const AppointmentTypeManager = () => {
  const appointmentTypeMutationsAvailable = !isRustV2ApiMode();
  // Use React Query hooks
  const { 
    data: appointmentTypes = [], 
    isLoading: loading 
  } = useAppointmentTypes();
  const createAppointmentTypeMutation = useCreateAppointmentType();
  const updateAppointmentTypeMutation = useUpdateAppointmentType();
  const deleteAppointmentTypeMutation = useDeleteAppointmentType();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const appointmentTypeToDeleteRef = useRef(null);
  // Define color options
  const colorOptions = [
    { name: 'Blue', value: '#1976D2' },
    { name: 'Red', value: '#D32F2F' },
    { name: 'Green', value: '#388E3C' },
    { name: 'Purple', value: '#7B1FA2' },
    { name: 'Orange', value: '#F57C00' },
    { name: 'Teal', value: '#00796B' },
    { name: 'Pink', value: '#C2185B' },
    { name: 'Indigo', value: '#303F9F' },
    { name: 'Amber', value: '#FFA000' },
    { name: 'Cyan', value: '#0097A7' },
  ];

  // Define category options
  const categoryOptions = [
    { name: 'In Person', value: 'in_person' },
    { name: 'Virtual', value: 'virtual' },
    { name: 'Home Visit', value: 'home_visit' },
    { name: 'Procedure', value: 'procedure' },
  ];

  const [currentAppointmentType, setCurrentAppointmentType] = useState({
    id: '',
    name: '',
    duration_minutes: 30,
    description: '',
    color: '#1976D2',
    is_active: true,
    category: 'in_person',
  });

  // No need for loadAppointmentTypes function or useEffect as React Query handles this

  // Handle form input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setCurrentAppointmentType({
      ...currentAppointmentType,
      [name]: name === 'duration_minutes' ? parseInt(value, 10) || 0 : value,
    });
  };

  // Handle switch input changes
  const handleSwitchChange = (checked) => {
    setCurrentAppointmentType({
      ...currentAppointmentType,
      is_active: checked,
    });
  };

  // Handle select input changes
  const handleSelectChange = (name, value) => {
    setCurrentAppointmentType({
      ...currentAppointmentType,
      [name]: value,
    });
  };

  // Reset form
  const resetForm = () => {
    setCurrentAppointmentType({
      id: '',
      name: '',
      duration_minutes: 30,
      description: '',
      color: '#1976D2',
      is_active: true,
      category: 'in_person',
    });
    setIsEditing(false);
  };

  // Open dialog for creating a new appointment type
  const handleAddNew = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  // Open dialog for editing an existing appointment type
  const handleEdit = (appointmentType) => {
    setCurrentAppointmentType(appointmentType);
    setIsEditing(true);
    setIsDialogOpen(true);
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!currentAppointmentType.name) {
      toast.error('Name is required');
      return;
    }

    if (!currentAppointmentType.duration_minutes || currentAppointmentType.duration_minutes <= 0) {
      toast.error('Duration must be a positive number');
      return;
    }

    if (!currentAppointmentType.category) {
      toast.error('Category is required');
      return;
    }

    if (isEditing) {
      // Update existing appointment type
      updateAppointmentTypeMutation.mutate(
        { 
          id: currentAppointmentType.id, 
          data: currentAppointmentType 
        },
        {
          onSuccess: () => {
            toast.success('Appointment type updated successfully');
            setIsDialogOpen(false);
            resetForm();
          },
          onError: (error) => {
            console.error('Error updating appointment type:', error);
            toast.error(error.message || 'Failed to update appointment type');
          }
        }
      );
    } else {
      // Create new appointment type
      createAppointmentTypeMutation.mutate(
        currentAppointmentType,
        {
          onSuccess: () => {
            toast.success('Appointment type created successfully');
            setIsDialogOpen(false);
            resetForm();
          },
          onError: (error) => {
            console.error('Error creating appointment type:', error);
            toast.error(error.message || 'Failed to create appointment type');
          }
        }
      );
    }
  };

  // Handle deletion of an appointment type
  const handleDelete = (id) => {
    appointmentTypeToDeleteRef.current = id;
    setIsDeleteDialogOpen(true);
  };

  // Confirm deletion of an appointment type
  const confirmDelete = () => {
    const appointmentTypeToDelete = appointmentTypeToDeleteRef.current;
    if (!appointmentTypeToDelete) return;

    deleteAppointmentTypeMutation.mutate(
      appointmentTypeToDelete,
      {
        onSuccess: () => {
          toast.success('Appointment type deleted successfully');
          setIsDeleteDialogOpen(false);
          appointmentTypeToDeleteRef.current = null;
        },
        onError: (error) => {
          console.error('Error deleting appointment type:', error);
          toast.error(error.message || 'Failed to delete appointment type');
        }
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Appointment Types</h2>
        {appointmentTypeMutationsAvailable ? (
          <Button onClick={handleAddNew} className="flex items-center gap-1">
            <PlusCircle className="h-4 w-4" />
            Add New
          </Button>
        ) : null}
      </div>

      {!appointmentTypeMutationsAvailable ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Appointment type management is not available in Rust V2 yet. Existing default
          types remain available for scheduling.
        </div>
      ) : null}

      {loading ? (
        <div className="text-center py-4">Loading appointment types...</div>
      ) : appointmentTypes.length === 0 ? (
        <div className="text-center py-4 border rounded-md bg-muted/20">
          <p className="text-muted-foreground">No appointment types found.</p>
          {appointmentTypeMutationsAvailable ? (
            <Button onClick={handleAddNew} variant="outline" className="mt-2">
              Create your first appointment type
            </Button>
          ) : null}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Duration (minutes)</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Color</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Description</TableHead>
              {appointmentTypeMutationsAvailable ? (
                <TableHead className="w-[100px]">Actions</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {appointmentTypes.map((type) => (
              <TableRow key={type.id}>
                <TableCell className="font-medium">{type.name}</TableCell>
                <TableCell>{type.duration_minutes}</TableCell>
                <TableCell>
                  {categoryOptions.find(c => c.value === type.category)?.name || type.category}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-5 w-5">
                      <AvatarFallback style={{ backgroundColor: type.color }}></AvatarFallback>
                    </Avatar>
                    {colorOptions.find(c => c.value === type.color)?.name || type.color}
                  </div>
                </TableCell>
                <TableCell>
                  {type.is_active ? 
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                      Active
                    </span> : 
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800">
                      Inactive
                    </span>
                  }
                </TableCell>
                <TableCell>{type.description}</TableCell>
                {appointmentTypeMutationsAvailable ? (
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(type)}
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(type.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isEditing ? 'Edit Appointment Type' : 'Create Appointment Type'}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update the details of this appointment type.'
                : 'Add a new appointment type to the system.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                value={currentAppointmentType.name}
                onChange={handleInputChange}
                placeholder="e.g., Regular Checkup"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration_minutes">Duration (minutes)</Label>
              <Input
                id="duration_minutes"
                name="duration_minutes"
                type="number"
                min="1"
                value={currentAppointmentType.duration_minutes}
                onChange={handleInputChange}
                placeholder="e.g., 30"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                name="description"
                value={currentAppointmentType.description}
                onChange={handleInputChange}
                placeholder="e.g., Standard consultation for regular patients"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select
                id="category"
                value={currentAppointmentType.category}
                onValueChange={(value) => handleSelectChange('category', value)}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="color">Color</Label>
              <Select
                id="color"
                value={currentAppointmentType.color}
                onValueChange={(value) => handleSelectChange('color', value)}
              >
                <SelectTrigger>
                  <SelectValue>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-5 w-5">
                        <AvatarFallback style={{ backgroundColor: currentAppointmentType.color }}></AvatarFallback>
                      </Avatar>
                      {colorOptions.find(c => c.value === currentAppointmentType.color)?.name || 'Select a color'}
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {colorOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback style={{ backgroundColor: option.value }}></AvatarFallback>
                        </Avatar>
                        {option.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="is_active"
                checked={currentAppointmentType.is_active}
                onCheckedChange={handleSwitchChange}
              />
              <Label htmlFor="is_active">Active</Label>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsDialogOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button type="submit">
                {isEditing ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the appointment type.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { appointmentTypeToDeleteRef.current = null; }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AppointmentTypeManager;
