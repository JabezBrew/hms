import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import {
  Search, Package, CheckCircle, Clock, AlertCircle,
  RefreshCw, User, Pill, CheckSquare, AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';
import {
  usePendingDispensing,
  useDispenseMedication,
  useBulkDispense
} from '@/hooks/useNursingQueries';

export function PharmacyQueue() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMeds, setSelectedMeds] = useState([]);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmMedication, setConfirmMedication] = useState(null);

  // Fetch pending dispensing
  const {
    data: pendingMeds,
    isLoading,
    error,
    refetch
  } = usePendingDispensing();

  // Mutations
  const dispenseMutation = useDispenseMedication();
  const bulkDispenseMutation = useBulkDispense();

  // Format timestamp
  const formatTime = (timestamp) => {
    if (!timestamp) return '-';
    try {
      return format(new Date(timestamp), 'h:mm a');
    } catch {
      return timestamp;
    }
  };

  const formatDateTime = (timestamp) => {
    if (!timestamp) return '-';
    try {
      return format(new Date(timestamp), 'MMM d, yyyy h:mm a');
    } catch {
      return timestamp;
    }
  };

  // Helper to get patient name - supports both lightweight and full serializer
  const getPatientName = (med) => {
    // Lightweight serializer: direct patient_name field
    if (med.patient_name) return med.patient_name;
    // Full serializer: nested patient_details
    if (med.patient_details?.user_details) {
      const { first_name, last_name } = med.patient_details.user_details;
      if (first_name || last_name) {
        return `${first_name || ''} ${last_name || ''}`.trim();
      }
    }
    if (med.patient_details?.user?.full_name) {
      return med.patient_details.user.full_name;
    }
    return 'Unknown Patient';
  };

  // Helper to get patient MRN
  const getPatientMRN = (med) => {
    return med.patient_mrn || med.patient_details?.medical_record_number || '-';
  };

  // Helper to get patient ward
  const getPatientWard = (med) => {
    return med.patient_ward || med.patient_details?.current_ward || 'Unknown';
  };

  // Helper to get prescriber name - supports both lightweight and full serializer
  const getPrescriberName = (med) => {
    // Lightweight serializer: direct prescriber_name field
    if (med.prescriber_name) return med.prescriber_name;
    // Full serializer: nested prescribed_by_details
    if (med.prescribed_by_details?.staff_details?.user_details) {
      const { first_name, last_name } = med.prescribed_by_details.staff_details.user_details;
      if (first_name || last_name) {
        return `Dr. ${first_name || ''} ${last_name || ''}`.trim();
      }
    }
    if (med.prescribed_by_details?.user?.full_name) {
      return `Dr. ${med.prescribed_by_details.user.full_name}`;
    }
    return '-';
  };

  // Filter medications
  const filteredMeds = (pendingMeds || []).filter(med => {
    const patientName = getPatientName(med);
    return (
      med.medication_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      med.dosage?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  // Group by patient - store first medication to get patient info from
  const groupedByPatient = filteredMeds.reduce((acc, med) => {
    const patientId = med.patient;
    if (!acc[patientId]) {
      acc[patientId] = {
        firstMed: med, // Store first med to extract patient info
        medications: []
      };
    }
    acc[patientId].medications.push(med);
    return acc;
  }, {});

  // Toggle medication selection
  const toggleMedSelection = (medId) => {
    setSelectedMeds(prev =>
      prev.includes(medId)
        ? prev.filter(id => id !== medId)
        : [...prev, medId]
    );
  };

  // Select all for a patient
  const selectAllForPatient = (patientId) => {
    const patientMeds = groupedByPatient[patientId]?.medications.map(m => m.id) || [];
    const allSelected = patientMeds.every(id => selectedMeds.includes(id));

    if (allSelected) {
      setSelectedMeds(prev => prev.filter(id => !patientMeds.includes(id)));
    } else {
      setSelectedMeds(prev => [...new Set([...prev, ...patientMeds])]);
    }
  };

  // Single dispense
  const handleDispense = async (medication) => {
    try {
      await dispenseMutation.mutateAsync(medication.id);
      toast.success(`${medication.medication_name} dispensed successfully`);
      setConfirmMedication(null);
      setShowConfirmDialog(false);
    } catch (error) {
      toast.error(error.message || 'Failed to dispense medication');
    }
  };

  // Bulk dispense
  const handleBulkDispense = async () => {
    if (selectedMeds.length === 0) {
      toast.error('No medications selected');
      return;
    }

    try {
      const result = await bulkDispenseMutation.mutateAsync(selectedMeds);
      toast.success(`${result.dispensed_count || selectedMeds.length} medications dispensed`);
      setSelectedMeds([]);
    } catch (error) {
      toast.error(error.message || 'Failed to dispense medications');
    }
  };

  // Open confirm dialog
  const openConfirmDialog = (medication) => {
    setConfirmMedication(medication);
    setShowConfirmDialog(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-red-500 flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Error Loading Queue
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            {error.message || 'Failed to load dispensing queue'}
          </p>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const totalPending = filteredMeds.length;
  const totalPatients = Object.keys(groupedByPatient).length;
  const totalOverdue = filteredMeds.filter(med => med.is_overdue).length;

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <Package className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalPending}</p>
                <p className="text-sm text-muted-foreground">Pending Dispensing</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {totalOverdue > 0 && (
          <Card className="border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg">
                  <AlertTriangle className="h-6 w-6 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600">{totalOverdue}</p>
                  <p className="text-sm text-red-600/80">Overdue</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <User className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalPatients}</p>
                <p className="text-sm text-muted-foreground">Patients Waiting</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                <CheckSquare className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{selectedMeds.length}</p>
                <p className="text-sm text-muted-foreground">Selected</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Actions */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search by patient name or medication..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {selectedMeds.length > 0 && (
            <Button
              onClick={handleBulkDispense}
              disabled={bulkDispenseMutation.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Dispense Selected ({selectedMeds.length})
            </Button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="by-patient">
        <TabsList>
          <TabsTrigger value="by-patient" className="flex items-center gap-1">
            <User className="h-4 w-4" />
            By Patient
          </TabsTrigger>
          <TabsTrigger value="all" className="flex items-center gap-1">
            <Pill className="h-4 w-4" />
            All Medications
          </TabsTrigger>
        </TabsList>

        {/* By Patient View */}
        <TabsContent value="by-patient" className="mt-4">
          {totalPatients === 0 ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
                  <h3 className="text-lg font-medium">Queue Empty</h3>
                  <p className="text-muted-foreground">
                    No medications pending dispensing at this time.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-4">
                {Object.entries(groupedByPatient).map(([patientId, data]) => {
                  const patientMedIds = data.medications.map(m => m.id);
                  const allSelected = patientMedIds.every(id => selectedMeds.includes(id));
                  const someSelected = patientMedIds.some(id => selectedMeds.includes(id));

                  return (
                    <Card key={patientId}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={allSelected}
                              onCheckedChange={() => selectAllForPatient(patientId)}
                              className={someSelected && !allSelected ? 'opacity-50' : ''}
                            />
                            <div>
                              <CardTitle className="text-base">
                                {getPatientName(data.firstMed)}
                              </CardTitle>
                              <CardDescription>
                                MRN: {getPatientMRN(data.firstMed)} |
                                {data.medications.length} medication{data.medications.length !== 1 ? 's' : ''} pending
                              </CardDescription>
                            </div>
                          </div>
                          <Badge variant="outline">
                            Ward: {getPatientWard(data.firstMed)}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10"></TableHead>
                              <TableHead>Medication</TableHead>
                              <TableHead>Dose</TableHead>
                              <TableHead>Route</TableHead>
                              <TableHead>Scheduled</TableHead>
                              <TableHead>Prescriber</TableHead>
                              <TableHead className="text-right">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {data.medications.map(med => (
                              <TableRow key={med.id} className={med.is_overdue ? 'bg-red-50 dark:bg-red-900/10' : ''}>
                                <TableCell>
                                  <Checkbox
                                    checked={selectedMeds.includes(med.id)}
                                    onCheckedChange={() => toggleMedSelection(med.id)}
                                  />
                                </TableCell>
                                <TableCell className="font-medium">
                                  <div className="flex items-center gap-2">
                                    {med.medication_name}
                                    {med.is_overdue && (
                                      <Badge variant="destructive" className="text-xs">
                                        <AlertTriangle className="h-3 w-3 mr-1" />
                                        Overdue
                                      </Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>{med.dosage}</TableCell>
                                <TableCell>{med.route}</TableCell>
                                <TableCell className="font-mono text-sm">
                                  <div className={med.is_overdue ? 'text-red-600 dark:text-red-400' : ''}>
                                    {formatTime(med.scheduled_time)}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {getPrescriberName(med)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    size="sm"
                                    variant={med.is_overdue ? 'destructive' : 'outline'}
                                    onClick={() => openConfirmDialog(med)}
                                    disabled={dispenseMutation.isPending}
                                  >
                                    <Package className="h-4 w-4 mr-1" />
                                    Dispense
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        {/* All Medications View */}
        <TabsContent value="all" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>All Pending Medications</CardTitle>
              <CardDescription>
                Complete list of medications awaiting dispensing
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredMeds.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
                  <p className="text-lg font-medium">No pending medications</p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={selectedMeds.length === filteredMeds.length && filteredMeds.length > 0}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedMeds(filteredMeds.map(m => m.id));
                              } else {
                                setSelectedMeds([]);
                              }
                            }}
                          />
                        </TableHead>
                        <TableHead>Patient</TableHead>
                        <TableHead>Medication</TableHead>
                        <TableHead>Dose</TableHead>
                        <TableHead>Route</TableHead>
                        <TableHead>Scheduled</TableHead>
                        <TableHead>Prescriber</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMeds.map(med => (
                        <TableRow key={med.id} className={med.is_overdue ? 'bg-red-50 dark:bg-red-900/10' : ''}>
                          <TableCell>
                            <Checkbox
                              checked={selectedMeds.includes(med.id)}
                              onCheckedChange={() => toggleMedSelection(med.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">
                                {getPatientName(med)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {getPatientMRN(med)}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {med.medication_name}
                              {med.is_overdue && (
                                <Badge variant="destructive" className="text-xs">
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  Overdue
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{med.dosage}</TableCell>
                          <TableCell>{med.route}</TableCell>
                          <TableCell className={`font-mono text-sm ${med.is_overdue ? 'text-red-600 dark:text-red-400' : ''}`}>
                            {formatDateTime(med.scheduled_time)}
                          </TableCell>
                          <TableCell>
                            {getPrescriberName(med)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant={med.is_overdue ? 'destructive' : 'outline'}
                              onClick={() => openConfirmDialog(med)}
                              disabled={dispenseMutation.isPending}
                            >
                              Dispense
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirm Dispense Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Dispensing</DialogTitle>
            <DialogDescription>
              Please verify the medication details before dispensing.
            </DialogDescription>
          </DialogHeader>

          {confirmMedication && (
            <div className="space-y-4 py-4">
              {confirmMedication.is_overdue && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
                  <AlertTriangle className="h-5 w-5" />
                  <span className="font-medium">This medication is overdue for dispensing</span>
                </div>
              )}
              <div className="bg-muted p-4 rounded-lg space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Patient:</span>
                  <span className="font-medium">
                    {getPatientName(confirmMedication)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">MRN:</span>
                  <span className="font-mono">
                    {getPatientMRN(confirmMedication)}
                  </span>
                </div>
                <hr className="border-border" />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Medication:</span>
                  <span className="font-medium">{confirmMedication.medication_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dosage:</span>
                  <span>{confirmMedication.dosage}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Route:</span>
                  <span>{confirmMedication.route}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Frequency:</span>
                  <span>{confirmMedication.frequency}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Scheduled:</span>
                  <span>{formatDateTime(confirmMedication.scheduled_time)}</span>
                </div>
                <hr className="border-border" />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Prescribed by:</span>
                  <span>
                    {getPrescriberName(confirmMedication)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleDispense(confirmMedication)}
              disabled={dispenseMutation.isPending}
            >
              {dispenseMutation.isPending ? 'Dispensing...' : 'Confirm Dispense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
