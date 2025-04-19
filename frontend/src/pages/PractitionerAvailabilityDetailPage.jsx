import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, ArrowLeft, Clock, Trash2, Edit } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

import { fetchScheduleTemplate, fetchTimeSlots, deleteTimeSlot } from '@/lib/api';
import TimeSlotForm from '@/components/appointments/TimeSlotForm';

// Day of week mapping
const DAYS_OF_WEEK = {
  0: 'Monday',
  1: 'Tuesday',
  2: 'Wednesday',
  3: 'Thursday',
  4: 'Friday',
  5: 'Saturday',
  6: 'Sunday',
};

const PractitionerAvailabilityDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [template, setTemplate] = useState(null);
  const [timeSlots, setTimeSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [timeSlotToDelete, setTimeSlotToDelete] = useState(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);

  // Load template and time slots
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [templateData, timeSlotsData] = await Promise.all([
          fetchScheduleTemplate(id),
          fetchTimeSlots(id)
        ]);
        
        setTemplate(templateData);
        setTimeSlots(Array.isArray(timeSlotsData) ? timeSlotsData : []);
      } catch (error) {
        console.error('Error loading data:', error);
        toast.error('Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      loadData();
    }
  }, [id]);

  // Handle time slot creation success
  const handleCreateSuccess = (newTimeSlot) => {
    setTimeSlots([...timeSlots, newTimeSlot]);
    setIsCreateDialogOpen(false);
    toast.success('Time slot created successfully');
  };

  // Handle time slot update success
  const handleUpdateSuccess = (updatedTimeSlot) => {
    setTimeSlots(timeSlots.map(slot => 
      slot.id === updatedTimeSlot.id ? updatedTimeSlot : slot
    ));
    setIsEditDialogOpen(false);
    toast.success('Time slot updated successfully');
  };

  // Handle time slot deletion
  const handleDelete = async () => {
    if (!timeSlotToDelete) return;

    try {
      await deleteTimeSlot(timeSlotToDelete.id);
      setTimeSlots(timeSlots.filter(slot => slot.id !== timeSlotToDelete.id));
      setIsDeleteDialogOpen(false);
      toast.success('Time slot deleted successfully');
    } catch (error) {
      console.error('Error deleting time slot:', error);
      toast.error('Failed to delete time slot');
    }
  };

  // Format time for display
  const formatTime = (timeString) => {
    try {
      const [hours, minutes] = timeString.split(':');
      const date = new Date();
      date.setHours(parseInt(hours, 10));
      date.setMinutes(parseInt(minutes, 10));
      
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      return timeString;
    }
  };

  // Render loading state
  if (loading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center space-x-2">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-10 w-1/3" />
        </div>
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  // If template not found
  if (!template) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Button variant="outline" onClick={() => navigate('/practitioner-availability')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Templates
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>Template Not Found</CardTitle>
            <CardDescription>
              The requested schedule template could not be found.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p>Please return to the templates list and try again.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Button variant="outline" onClick={() => navigate('/practitioner-availability')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">{template.name}</h1>
          <Badge variant={template.is_active ? "success" : "secondary"}>
            {template.is_active ? "Active" : "Inactive"}
          </Badge>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Time Slot
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Time Slots</CardTitle>
          <CardDescription>
            Define when the practitioner is available for appointments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timeSlots.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-medium">No Time Slots</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Add time slots to define when the practitioner is available for appointments.
              </p>
              <Button className="mt-4" onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Time Slot
              </Button>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Start Time</TableHead>
                    <TableHead>End Time</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timeSlots
                    .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time))
                    .map((slot) => {
                      // Calculate duration
                      const startParts = slot.start_time.split(':').map(Number);
                      const endParts = slot.end_time.split(':').map(Number);
                      const startMinutes = startParts[0] * 60 + startParts[1];
                      const endMinutes = endParts[0] * 60 + endParts[1];
                      const durationMinutes = endMinutes - startMinutes;
                      const hours = Math.floor(durationMinutes / 60);
                      const minutes = durationMinutes % 60;
                      const durationText = `${hours > 0 ? `${hours}h ` : ''}${minutes > 0 ? `${minutes}m` : ''}`;
                      
                      return (
                        <TableRow key={slot.id}>
                          <TableCell className="font-medium">{DAYS_OF_WEEK[slot.day_of_week]}</TableCell>
                          <TableCell>{formatTime(slot.start_time)}</TableCell>
                          <TableCell>{formatTime(slot.end_time)}</TableCell>
                          <TableCell>{durationText}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end space-x-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setSelectedTimeSlot(slot);
                                  setIsEditDialogOpen(true);
                                }}
                              >
                                <Edit className="h-4 w-4" />
                                <span className="sr-only">Edit</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive"
                                onClick={() => {
                                  setTimeSlotToDelete(slot);
                                  setIsDeleteDialogOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                                <span className="sr-only">Delete</span>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Time Slot Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add Time Slot</DialogTitle>
            <DialogDescription>
              Add a new time slot to define when the practitioner is available.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="p-1">
              <TimeSlotForm 
                templateId={id}
                onSuccess={handleCreateSuccess}
              />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Edit Time Slot Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Time Slot</DialogTitle>
            <DialogDescription>
              Update the time slot details.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="p-1">
              {selectedTimeSlot && (
                <TimeSlotForm 
                  initialData={selectedTimeSlot}
                  templateId={id}
                  onSuccess={handleUpdateSuccess}
                />
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Delete Time Slot Alert Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Time Slot</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this time slot? This action cannot be undone.
            </AlertDialogDescription>
            {timeSlotToDelete && (
                <div className="mt-2 font-medium">
                  {DAYS_OF_WEEK[timeSlotToDelete.day_of_week]}: {formatTime(timeSlotToDelete.start_time)} - {formatTime(timeSlotToDelete.end_time)}
                </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default PractitionerAvailabilityDetailPage;