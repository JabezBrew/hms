/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import format from 'date-fns/format';
import isAfter from 'date-fns/isAfter';
import isBefore from 'date-fns/isBefore';
import addHours from 'date-fns/addHours';

import { toast } from 'sonner';
import {
  usePatientMAR,
  useAdministerMedication
} from '@/features/nursing/hooks';

const NON_ADMINISTERED_STATUSES = ['missed', 'refused', 'held'];
const COMPLETED_MEDICATION_STATUSES = ['administered', 'missed', 'refused', 'held'];

function formatTime(timestamp) {
  if (!timestamp) return '-';
  try {
    return format(new Date(timestamp), 'h:mm a');
  } catch {
    return timestamp;
  }
}

function formatDateTime(timestamp) {
  if (!timestamp) return '-';
  try {
    return format(new Date(timestamp), 'MMM d, yyyy h:mm a');
  } catch {
    return timestamp;
  }
}

function formatSelectedDate(selectedDate) {
  try {
    return format(new Date(selectedDate), 'MMMM d, yyyy');
  } catch {
    return selectedDate;
  }
}

function isOverdue(scheduledTime) {
  if (!scheduledTime) return false;
  return isBefore(new Date(scheduledTime), new Date());
}

function isDueSoon(scheduledTime) {
  if (!scheduledTime) return false;
  const scheduled = new Date(scheduledTime);
  const now = new Date();
  const oneHourFromNow = addHours(now, 1);
  return isAfter(scheduled, now) && isBefore(scheduled, oneHourFromNow);
}

function getMedicationStatusBadge(medication) {
  if (medication.status === 'administered') {
    return <Badge className="bg-emerald-600">Administered</Badge>;
  }
  if (medication.status === 'missed') {
    return <Badge variant="destructive">Missed</Badge>;
  }
  if (medication.status === 'refused') {
    return <Badge className="bg-amber-600">Refused</Badge>;
  }
  if (medication.status === 'held') {
    return <Badge variant="outline">Held</Badge>;
  }

  if (!medication.is_dispensed) {
    return <Badge variant="outline" className="border-slate-400">Awaiting Dispensing</Badge>;
  }
  if (isOverdue(medication.scheduled_time)) {
    return <Badge variant="destructive">Overdue</Badge>;
  }
  if (isDueSoon(medication.scheduled_time)) {
    return <Badge className="bg-amber-500">Due Soon</Badge>;
  }
  return <Badge variant="outline">Scheduled</Badge>;
}

function filterMedicationList(meds, searchTerm) {
  if (!Array.isArray(meds)) return [];
  const normalizedSearch = searchTerm.toLowerCase();
  return meds.filter(med =>
    med.medication_name?.toLowerCase().includes(normalizedSearch) ||
    med.dosage?.toLowerCase().includes(normalizedSearch)
  );
}

export function MedicationAdministration({ patient }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [selectedMedication, setSelectedMedication] = useState(null);
  const [showAdminDialog, setShowAdminDialog] = useState(false);
  const [adminForm, setAdminForm] = useState({
    status: 'administered',
    administration_notes: '',
    reason_not_given: ''
  });

  // Fetch MAR for patient
  const {
    data: marData,
    isLoading: marLoading,
    error: marError,
    refetch: refetchMAR
  } = usePatientMAR(patient?.id, selectedDate);

  // Administer mutation
  const administerMutation = useAdministerMedication();

  // Handle admin form changes
  const handleAdminFormChange = (field, value) => {
    setAdminForm(prev => ({ ...prev, [field]: value }));
  };

  // Open administration dialog
  const openAdminDialog = (medication) => {
    setSelectedMedication(medication);
    setAdminForm({
      status: 'administered',
      administration_notes: '',
      reason_not_given: ''
    });
    setShowAdminDialog(true);
  };

  // Submit administration
  const handleAdminister = async () => {
    if (!selectedMedication) return;

    // Validate reason for non-administered statuses
    if (NON_ADMINISTERED_STATUSES.includes(adminForm.status) && !adminForm.reason_not_given) {
      toast.error('Please provide a reason');
      return;
    }

    try {
      await administerMutation.mutateAsync({
        medicationId: selectedMedication.id,
        data: {
          status: adminForm.status,
          administration_notes: adminForm.administration_notes,
          reason_not_given: adminForm.reason_not_given,
          administered_time: new Date().toISOString()
        }
      });

      toast.success(
        adminForm.status === 'administered'
          ? 'Medication administered successfully'
          : `Medication marked as ${adminForm.status}`
      );
      setShowAdminDialog(false);
      setSelectedMedication(null);
      refetchMAR();
    } catch (error) {
      toast.error(error.message || 'Failed to record medication administration');
    }
  };

  // Get medications by category
  const getScheduledMeds = () => {
    if (!marData?.medications) return [];
    return filterMedicationList(marData.medications.filter(m => m.status === 'scheduled'), searchTerm);
  };

  const getCompletedMeds = () => {
    if (!marData?.medications) return [];
    return filterMedicationList(
      marData.medications.filter(m => COMPLETED_MEDICATION_STATUSES.includes(m.status)),
      searchTerm
    );
  };

  const getDueMeds = () => {
    const scheduled = getScheduledMeds();
    return scheduled.filter(m =>
      m.is_dispensed && (isOverdue(m.scheduled_time) || isDueSoon(m.scheduled_time))
    );
  };

  if (!patient) {
    return <MedicationPatientEmptyState />;
  }

  if (marLoading) {
    return <MedicationLoadingState />;
  }

  if (marError) {
    return <MedicationErrorState error={marError} onRetry={refetchMAR} />;
  }

  const dueMeds = getDueMeds();
  const scheduledMeds = getScheduledMeds();
  const completedMeds = getCompletedMeds();

  return (
    <div className="space-y-6">
      <MedicationToolbar
        searchTerm={searchTerm}
        selectedDate={selectedDate}
        onSearchTermChange={setSearchTerm}
        onSelectedDateChange={setSelectedDate}
        onRefresh={refetchMAR}
      />

      <DueMedicationAlert
        dueMeds={dueMeds}
        onAdminister={openAdminDialog}
      />

      <MedicationTabs
        dueMeds={dueMeds}
        scheduledMeds={scheduledMeds}
        completedMeds={completedMeds}
        selectedDate={selectedDate}
        onAdminister={openAdminDialog}
      />

      <MedicationAdministrationDialog
        open={showAdminDialog}
        medication={selectedMedication}
        adminForm={adminForm}
        isSubmitting={administerMutation.isPending}
        onOpenChange={setShowAdminDialog}
        onFormChange={handleAdminFormChange}
        onSubmit={handleAdminister}
      />
    </div>
  );
}

function MedicationPatientEmptyState() {
  return (
    <Card>
      <CardContent className="py-8">
        <div className="text-center text-muted-foreground">
          <Pill className="size-12 mx-auto mb-2 opacity-50" />
          <p>Select a patient to view medications</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MedicationLoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function MedicationErrorState({ error, onRetry }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-red-500 flex items-center gap-2">
          <AlertCircle className="size-5" />
          Error Loading Medications
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-4">
          {error.message || 'Failed to load medication data'}
        </p>
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="size-4 mr-2" />
          Try Again
        </Button>
      </CardContent>
    </Card>
  );
}

function MedicationToolbar({
  searchTerm,
  selectedDate,
  onSearchTermChange,
  onSelectedDateChange,
  onRefresh
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground size-4" />
        <Input
          placeholder="Search medications..."
          className="pl-10"
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="date-filter" className="sr-only">Date</Label>
        <Input
          id="date-filter"
          type="date"
          value={selectedDate}
          onChange={(event) => onSelectedDateChange(event.target.value)}
          className="w-40"
        />
        <Button
          variant="outline"
          size="icon"
          onClick={onRefresh}
          aria-label="Refresh medication administration record"
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function DueMedicationAlert({ dueMeds, onAdminister }) {
  if (dueMeds.length === 0) {
    return null;
  }

  return (
    <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <AlertTriangle className="size-5" />
          {dueMeds.length} Medication{dueMeds.length !== 1 ? 's' : ''} Due Now
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {dueMeds.slice(0, 3).map(med => (
            <div
              key={med.id}
              className="flex items-center justify-between p-3 bg-white dark:bg-slate-900 rounded-lg border"
            >
              <div>
                <span className="font-medium">{med.medication_name}</span>
                <span className="text-muted-foreground ml-2">{med.dosage} - {med.route}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {formatTime(med.scheduled_time)}
                </span>
                <Button size="sm" onClick={() => onAdminister(med)}>
                  Administer
                </Button>
              </div>
            </div>
          ))}
          {dueMeds.length > 3 && (
            <p className="text-sm text-muted-foreground text-center pt-2">
              +{dueMeds.length - 3} more medications due
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MedicationTabs({
  dueMeds,
  scheduledMeds,
  completedMeds,
  selectedDate,
  onAdminister
}) {
  return (
    <Tabs defaultValue="due">
      <TabsList>
        <TabsTrigger value="due" className="flex items-center gap-1">
          <Clock className="size-4" />
          Due ({dueMeds.length})
        </TabsTrigger>
        <TabsTrigger value="scheduled" className="flex items-center gap-1">
          <Pill className="size-4" />
          Scheduled ({scheduledMeds.length})
        </TabsTrigger>
        <TabsTrigger value="completed" className="flex items-center gap-1">
          <CheckCircle className="size-4" />
          Completed ({completedMeds.length})
        </TabsTrigger>
      </TabsList>

      <DueMedicationsTab dueMeds={dueMeds} onAdminister={onAdminister} />
      <ScheduledMedicationsTab
        scheduledMeds={scheduledMeds}
        selectedDate={selectedDate}
        onAdminister={onAdminister}
      />
      <CompletedMedicationsTab completedMeds={completedMeds} selectedDate={selectedDate} />
    </Tabs>
  );
}

function DueMedicationsTab({ dueMeds, onAdminister }) {
  return (
    <TabsContent value="due" className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Medications Due</CardTitle>
          <CardDescription>
            Dispensed medications that are due or overdue for administration
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dueMeds.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="size-12 text-emerald-500 mx-auto mb-2" />
              <p className="text-lg font-medium">No medications due</p>
              <p className="text-muted-foreground">
                All scheduled medications have been administered or are not yet due.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {dueMeds.map(medication => (
                  <MedicationCard
                    key={medication.id}
                    medication={medication}
                    onAdminister={() => onAdminister(medication)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}

function ScheduledMedicationsTab({ scheduledMeds, selectedDate, onAdminister }) {
  return (
    <TabsContent value="scheduled" className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Scheduled Medications</CardTitle>
          <CardDescription>
            All medications scheduled for {formatSelectedDate(selectedDate)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scheduledMeds.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Pill className="size-12 mx-auto mb-2 opacity-50" />
              <p>No scheduled medications for this date</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Medication</TableHead>
                    <TableHead>Dose</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scheduledMeds.map(medication => (
                    <TableRow key={medication.id}>
                      <TableCell className="font-mono">
                        {formatTime(medication.scheduled_time)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {medication.medication_name}
                      </TableCell>
                      <TableCell>{medication.dosage}</TableCell>
                      <TableCell>{medication.route}</TableCell>
                      <TableCell>{getMedicationStatusBadge(medication)}</TableCell>
                      <TableCell>
                        {medication.is_dispensed ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onAdminister(medication)}
                          >
                            Administer
                          </Button>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            <Package className="size-4 inline mr-1" />
                            Awaiting pharmacy
                          </span>
                        )}
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
  );
}

function CompletedMedicationsTab({ completedMeds, selectedDate }) {
  return (
    <TabsContent value="completed" className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Administration History</CardTitle>
          <CardDescription>
            Medication administrations for {formatSelectedDate(selectedDate)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {completedMeds.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="size-12 mx-auto mb-2 opacity-50" />
              <p>No completed administrations for this date</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Administered</TableHead>
                    <TableHead>Medication</TableHead>
                    <TableHead>Dose</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Administered By</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {completedMeds.map(medication => (
                    <TableRow key={medication.id}>
                      <TableCell className="font-mono">
                        {formatTime(medication.scheduled_time)}
                      </TableCell>
                      <TableCell className="font-mono">
                        {formatTime(medication.administered_time)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {medication.medication_name}
                      </TableCell>
                      <TableCell>{medication.dosage}</TableCell>
                      <TableCell>{getMedicationStatusBadge(medication)}</TableCell>
                      <TableCell>
                        {medication.administered_by_details?.user?.full_name || '-'}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {medication.administration_notes || medication.reason_not_given || '-'}
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
  );
}

function MedicationAdministrationDialog({
  open,
  medication,
  adminForm,
  isSubmitting,
  onOpenChange,
  onFormChange,
  onSubmit
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Medication Administration</DialogTitle>
          <DialogDescription>
            {medication?.medication_name} - {medication?.dosage}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="bg-muted p-3 rounded-lg space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Route:</span>
              <span>{medication?.route}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Frequency:</span>
              <span>{medication?.frequency}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Scheduled:</span>
              <span>{formatDateTime(medication?.scheduled_time)}</span>
            </div>
            {medication?.prescribed_by_details && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Prescribed by:</span>
                <span>{medication.prescribed_by_details.user?.full_name}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Administration Status</Label>
            <Select
              value={adminForm.status}
              onValueChange={(value) => onFormChange('status', value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="administered">
                  <span className="flex items-center gap-2">
                    <CheckCircle className="size-4 text-emerald-500" />
                    Administered
                  </span>
                </SelectItem>
                <SelectItem value="missed">
                  <span className="flex items-center gap-2">
                    <XCircle className="size-4 text-red-500" />
                    Missed
                  </span>
                </SelectItem>
                <SelectItem value="refused">
                  <span className="flex items-center gap-2">
                    <XCircle className="size-4 text-amber-500" />
                    Patient Refused
                  </span>
                </SelectItem>
                <SelectItem value="held">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="size-4 text-slate-500" />
                    Held
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {NON_ADMINISTERED_STATUSES.includes(adminForm.status) && (
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Textarea
                placeholder="Reason medication was not administered..."
                value={adminForm.reason_not_given}
                onChange={(event) => onFormChange('reason_not_given', event.target.value)}
                rows={2}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              placeholder="Additional observations or notes..."
              value={adminForm.administration_notes}
              onChange={(event) => onFormChange('administration_notes', event.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Recording...' : 'Record Administration'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MedicationCard({ medication, onAdminister }) {
  const isUrgent = isOverdue(medication.scheduled_time);
  const isDue = isDueSoon(medication.scheduled_time);

  return (
    <div
      className={`p-4 border rounded-lg hover:bg-muted/50 transition-colors ${
        isUrgent ? 'border-red-300 bg-red-50 dark:bg-red-950/20' :
        isDue ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20' : ''
      }`}
    >
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-medium">{medication.medication_name}</h3>
          <p className="text-sm text-muted-foreground">
            {medication.dosage} - {medication.route}
          </p>
          {medication.frequency && (
            <p className="text-sm text-muted-foreground">
              {medication.frequency}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {getMedicationStatusBadge(medication)}
          <div className="flex items-center text-sm text-muted-foreground">
            <Clock className="size-3 mr-1" />
            {formatTime(medication.scheduled_time)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex justify-between items-center">
        {medication.prescribed_by_details && (
          <span className="text-sm text-muted-foreground">
            Prescribed by: {medication.prescribed_by_details.user?.full_name}
          </span>
        )}
        <Button
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onAdminister();
          }}
        >
          Administer
        </Button>
      </div>
    </div>
  );
}
