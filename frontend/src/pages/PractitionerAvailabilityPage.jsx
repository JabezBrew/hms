import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Calendar, Trash2, Edit, RefreshCw, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

import { fetchScheduleTemplates, fetchPractitioners, deleteScheduleTemplate, fetchSchedules, cancelSchedule } from '@/lib/api.js';
import ScheduleTemplateForm from '@/components/appointments/ScheduleTemplateForm';
import GenerateScheduleForm from '@/components/appointments/GenerateScheduleForm';


const PractitionerAvailabilityPage = () => {
  const [templates, setTemplates] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schedulesLoading, setSchedulesLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState(null);
  const [practitioners, setPractitioners] = useState([]);
  const navigate = useNavigate();

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

  // Load schedule templates
  useEffect(() => {
    const loadTemplates = async () => {
      setLoading(true);
      try {
        const data = await fetchScheduleTemplates();
        setTemplates(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error loading schedule templates:', error);
        toast.error('Failed to load schedule templates');
      } finally {
        setLoading(false);
      }
    };

    loadTemplates();
  }, []);

  // Load practitioners
  useEffect(() => {
    const loadPractitioners = async () => {
      try {
        const data = await fetchPractitioners();
        setPractitioners(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error loading practitioners:', error);
        toast.error('Failed to load practitioners');
      }
    };

    loadPractitioners();
  }, []);

  // Load schedules
  useEffect(() => {
    const loadSchedules = async () => {
      setSchedulesLoading(true);
      try {
        const data = await fetchSchedules();
        setSchedules(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error loading schedules:', error);
        toast.error('Failed to load schedules');
      } finally {
        setSchedulesLoading(false);
      }
    };

    loadSchedules();
  }, []);

  // Handle template creation success
  const handleCreateSuccess = (newTemplate) => {
    setTemplates([...templates, newTemplate]);
    setIsCreateDialogOpen(false);
    toast.success('Schedule template created successfully');
  };

  // Handle template update success
  const handleUpdateSuccess = (updatedTemplate) => {
    setTemplates(templates.map(template =>
        template.id === updatedTemplate.id ? updatedTemplate : template
    ));
    setIsEditDialogOpen(false);
    toast.success('Schedule template updated successfully');
  };

  // Handle template deletion
  const handleDelete = async (templateId) => {
    if (!templateToDelete) return;

    try {
      await deleteScheduleTemplate(templateId);
      setTemplates(templates.filter(template => template.id !== templateId));
      toast.success('Schedule template deleted successfully');
    } catch (error) {
      console.error('Error deleting schedule template:', error);
      toast.error('Failed to delete schedule template');
    }
  };

  // Handle generate schedule success
  const handleGenerateSuccess = () => {
    setIsGenerateDialogOpen(false);
    // Reload schedules after successful generation
    const loadSchedules = async () => {
      try {
        const data = await fetchSchedules();
        setSchedules(Array.isArray(data) ? data : []);
        toast.success('Schedule generated successfully');
      } catch (error) {
        console.error('Error reloading schedules:', error);
      }
    };
    loadSchedules();
  };

  // Handle cancel schedule
  const handleCancelSchedule = async () => {
    if (!selectedSchedule) return;

    try {
      await cancelSchedule(selectedSchedule.id);
      // Update the schedule status locally
      setSchedules(schedules.map(schedule =>
          schedule.id === selectedSchedule.id
              ? { ...schedule, status: 'cancelled' }
              : schedule
      ));
      setIsCancelDialogOpen(false);
      toast.success('Schedule cancelled successfully');
    } catch (error) {
      console.error('Error cancelling schedule:', error);
      toast.error('Failed to cancel schedule');
    }
  };

  // Find practitioner name by ID
  const getPractitionerName = (practitionerId) => {
    const practitioner = practitioners.find(p => p.id === practitionerId);
    if (!practitioner) return 'Unknown';

    return `${practitioner.staff_details?.user_details?.first_name} ${practitioner.staff_details?.user_details?.last_name}`;
  };

  const getPractitionerType = (practitionerId) => {
    const practitioner = practitioners.find(p => p.id === practitionerId);
    if (!practitioner) return <Badge>Unknown</Badge>;

    return <Badge className={getUserTypeBadgeColor(practitioner.staff_details?.user_details?.user_type)}>
      {formatUserType(practitioner.staff_details?.user_details?.user_type)}
    </Badge>
  }

  // Get template name by ID
  const getTemplateName = (templateId) => {
    const template = templates.find(t => t.id === templateId);
    return template ? template.name : 'Unknown Template';
  };

  // Render loading state
  if (loading) {
    return (
        <div className="container mx-auto py-6 space-y-6">
          <div className="flex justify-between items-center">
            <Skeleton className="h-10 w-1/3" />
            <Skeleton className="h-10 w-24" />
          </div>
          <Skeleton className="h-[500px] w-full" />
        </div>
    );
  }

  return (
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold tracking-tight">Practitioner Availability</h1>
          <Button onClick={() => setIsCreateDialogOpen(true)} className="ml-25">
            <Plus className="mr-2 h-4 w-4" />
            New Template
          </Button>
        </div>

        <Tabs defaultValue="templates" className="w-full">
          <TabsList>
            <TabsTrigger value="templates">Schedule Templates</TabsTrigger>
            <TabsTrigger value="schedules">Generated Schedules</TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="space-y-4">
            {templates.length === 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>No Schedule Templates</CardTitle>
                    <CardDescription>
                      Create a schedule template to define when practitioners are available for appointments.
                    </CardDescription>
                  </CardHeader>
                  <CardFooter>
                    <Button onClick={() => setIsCreateDialogOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Template
                    </Button>
                  </CardFooter>
                </Card>
            ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Practitioner</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {templates.map((template) => (
                          <TableRow key={template.id}>
                            <TableCell className="font-medium">{template.name}</TableCell>
                            <TableCell>{getPractitionerName(template.practitioner)}</TableCell>
                            <TableCell>{getPractitionerType(template.practitioner)}</TableCell>
                            <TableCell>
                              <Badge variant={template.is_active ? "success" : "secondary"}>
                                {template.is_active ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell>{new Date(template.created_at).toLocaleDateString()}</TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">Open menu</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                                      <circle cx="12" cy="12" r="1"></circle>
                                      <circle cx="12" cy="5" r="1"></circle>
                                      <circle cx="12" cy="19" r="1"></circle>
                                    </svg>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                  <DropdownMenuItem
                                      onClick={() => {
                                        setSelectedTemplate(template);
                                        setIsEditDialogOpen(true);
                                      }}
                                  >
                                    <Edit className="mr-2 h-4 w-4" />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                      onClick={() => {
                                        setSelectedTemplate(template);
                                        setIsGenerateDialogOpen(true);
                                      }}
                                  >
                                    <Calendar className="mr-2 h-4 w-4" />
                                    Generate Schedule
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                      onClick={() => navigate(`/practitioner-availability/${template.id}`)}
                                  >
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Manage Time Slots
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                      className="text-destructive"
                                      onClick={() => {
                                        setTemplateToDelete(template);
                                        setIsDeleteDialogOpen(true);
                                      }}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
            )}
          </TabsContent>

          <TabsContent value="schedules" className="space-y-4">
            {schedulesLoading ? (
                <Skeleton className="h-[400px] w-full" />
            ) : schedules.length === 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>No Generated Schedules</CardTitle>
                    <CardDescription>
                      Generate a schedule from a template to make slots available for appointments.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      To generate a schedule, select a template from the "Schedule Templates" tab and click "Generate Schedule".
                    </p>
                  </CardContent>
                </Card>
            ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Template</TableHead>
                        <TableHead>Practitioner</TableHead>
                        <TableHead>Date Range</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Slots</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {schedules.map((schedule) => (
                          <TableRow key={schedule.id}>
                            <TableCell className="font-mono text-xs">{schedule.id.substring(0, 8)}...</TableCell>
                            <TableCell>{schedule.template_name}</TableCell>
                            <TableCell>{getPractitionerName(schedule.practitioner)}</TableCell>
                            <TableCell>
                              {new Date(schedule.start_date).toLocaleDateString()} - {new Date(schedule.end_date).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Badge variant={
                                schedule.status === 'active' ? 'success' :
                                    schedule.status === 'cancelled' ? 'destructive' :
                                        'secondary'
                              }>
                                {schedule.status === 'active' ? 'Active' :
                                    schedule.status === 'cancelled' ? 'Cancelled' :
                                        schedule.status}
                              </Badge>
                            </TableCell>
                            <TableCell>{schedule.slots_count || 0}</TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">Open menu</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                                      <circle cx="12" cy="12" r="1"></circle>
                                      <circle cx="12" cy="5" r="1"></circle>
                                      <circle cx="12" cy="19" r="1"></circle>
                                    </svg>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                  <DropdownMenuItem
                                      onClick={() => navigate(`/schedules/${schedule.id}/slots`)}
                                  >
                                    <Calendar className="mr-2 h-4 w-4" />
                                    View Slots
                                  </DropdownMenuItem>
                                  {schedule.status === 'active' && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            className="text-destructive"
                                            onClick={() => {
                                              setSelectedSchedule(schedule);
                                              setIsCancelDialogOpen(true);
                                            }}
                                        >
                                          <AlertCircle className="mr-2 h-4 w-4" />
                                          Cancel Schedule
                                        </DropdownMenuItem>
                                      </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Create Template Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Create Schedule Template</DialogTitle>
              <DialogDescription>
                Create a new schedule template for a practitioner.
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh]">
              <div className="p-1">
                <ScheduleTemplateForm
                    onSuccess={handleCreateSuccess}
                    practitioners={practitioners}
                />
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* Edit Template Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Edit Schedule Template</DialogTitle>
              <DialogDescription>
                Update the schedule template details.
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh]">
              <div className="p-1">
                {selectedTemplate && (
                    <ScheduleTemplateForm
                        initialData={selectedTemplate}
                        onSuccess={handleUpdateSuccess}
                        practitioners={practitioners}
                    />
                )}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* Generate Schedule Dialog */}
        <Dialog open={isGenerateDialogOpen} onOpenChange={setIsGenerateDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Generate Schedule</DialogTitle>
              <DialogDescription>
                Generate a schedule from this template for a specific date range.
              </DialogDescription>
            </DialogHeader>
            {selectedTemplate && (
                <GenerateScheduleForm
                    templateId={selectedTemplate.id}
                    templateName={selectedTemplate.name}
                    onSuccess={handleGenerateSuccess}
                />
            )}
          </DialogContent>
        </Dialog>

        {/* Delete Template Alert Dialog */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Schedule Template</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this template? This action cannot be undone.
              </AlertDialogDescription>
              {templateToDelete && (
                  <div className="mt-2 font-medium">{templateToDelete.name}</div>
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

        {/* Cancel Schedule Alert Dialog */}
        <AlertDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel Schedule</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to cancel this schedule? This will mark all available slots as unavailable and prevent any new appointments from being scheduled.
                <br/><br/>
                <span className="font-semibold">Note:</span> Existing appointments will not be affected, but you'll need to manually reschedule them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleCancelSchedule} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Yes, Cancel Schedule
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
  );
};

export default PractitionerAvailabilityPage;