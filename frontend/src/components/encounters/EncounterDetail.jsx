import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, parseISO, isValid } from 'date-fns';
import { fetchEncounter, dischargeEncounter, cancelEncounter } from '@/lib/api';
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
  Calendar,
  Clock,
  User,
  Building2,
  Activity,
  FileText,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  ArrowLeft,
  Clipboard,
  ClipboardList,
  Stethoscope,
  CalendarClock
} from 'lucide-react';

export function EncounterDetail({ encounter: initialEncounter, loading: initialLoading }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [loading, setLoading] = useState(initialLoading ?? true);
  const [encounter, setEncounter] = useState(initialEncounter ?? null);
  const [error, setError] = useState(null);
  const [showDischargeDialog, setShowDischargeDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);

  // Update state when props change
  useEffect(() => {
    setLoading(initialLoading ?? false);
    setEncounter(initialEncounter ?? null);
  }, [initialEncounter, initialLoading]);

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    
    try {
      const date = parseISO(dateString);
      return isValid(date) ? format(date, 'MMM d, yyyy h:mm a') : 'Invalid date';
    } catch (error) {
      return 'Invalid date';
    }
  };

  // Get status badge variant
  const getStatusBadge = (status) => {
    switch (status) {
      case 'planned':
        return <Badge variant="outline">Planned</Badge>;
      case 'in-progress':
        return <Badge variant="secondary">In Progress</Badge>;
      case 'finished':
        return <Badge variant="success">Finished</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Get encounter type badge
  const getTypeBadge = (type) => {
    switch (type) {
      case 'inpatient':
        return <Badge variant="default">Inpatient</Badge>;
      case 'outpatient':
        return <Badge variant="outline">Outpatient</Badge>;
      case 'emergency':
        return <Badge variant="destructive">Emergency</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  // Handle discharge patient
  const handleDischarge = async () => {
    try {
      setActionInProgress(true);
      await dischargeEncounter(id, {
        discharge_disposition: 'home',
        destination: 'Home'
      });
      
      // Reload encounter data
      const updatedEncounter = await fetchEncounter(id);
      setEncounter(updatedEncounter);
      
      setShowDischargeDialog(false);
    } catch (err) {
      console.error('Error discharging patient:', err);
      setError('Failed to discharge patient. Please try again.');
    } finally {
      setActionInProgress(false);
    }
  };

  // Handle cancel encounter
  const handleCancel = async () => {
    try {
      setActionInProgress(true);
      await cancelEncounter(id);
      
      // Reload encounter data
      const updatedEncounter = await fetchEncounter(id);
      setEncounter(updatedEncounter);
      
      setShowCancelDialog(false);
    } catch (err) {
      console.error('Error cancelling encounter:', err);
      setError('Failed to cancel encounter. Please try again.');
    } finally {
      setActionInProgress(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-red-500">Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{error}</p>
          <Button 
            variant="outline" 
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!encounter) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Encounter Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <p>The requested encounter could not be found.</p>
          <Button 
            variant="outline" 
            className="mt-4"
            onClick={() => navigate('/encounters')}
          >
            Back to Encounters
          </Button>
        </CardContent>
      </Card>
    );
  }

  const canEdit = encounter.status === 'planned' || encounter.status === 'in-progress';
  const canDischarge = encounter.encounter_type === 'inpatient' && 
                      (encounter.status === 'in-progress') && 
                      !encounter.end_time;
  const canCancel = encounter.status === 'planned' || encounter.status === 'in-progress';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="icon" onClick={() => navigate('/encounters')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Encounter Details</h1>
        </div>
        <div className="flex space-x-2">
          {canEdit && (
            <Button onClick={() => navigate(`/encounters/${id}/edit`)}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
          {canDischarge && (
            <Button variant="secondary" onClick={() => setShowDischargeDialog(true)}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Discharge Patient
            </Button>
          )}
          {canCancel && (
            <Button variant="destructive" onClick={() => setShowCancelDialog(true)}>
              <XCircle className="h-4 w-4 mr-2" />
              Cancel Encounter
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="flex items-center">
                <User className="h-5 w-5 mr-2 text-primary" />
                {encounter.patient_name || 'Unknown Patient'}
              </CardTitle>
              <CardDescription>
                Encounter ID: {encounter.id}
              </CardDescription>
            </div>
            <div className="flex space-x-2">
              {getTypeBadge(encounter.encounter_type)}
              {getStatusBadge(encounter.status)}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-1">Practitioner</h3>
                <div className="flex items-center">
                  <Stethoscope className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span>{encounter.practitioner_name || 'No practitioner assigned'}</span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">Start Time</h3>
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span>{formatDate(encounter.start_time)}</span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">End Time</h3>
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span>{encounter.end_time ? formatDate(encounter.end_time) : 'Not ended'}</span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">Location</h3>
                <div className="flex items-center">
                  <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span>{encounter.location || 'No location specified'}</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-1">Service Type</h3>
                <div className="flex items-center">
                  <Activity className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span>{encounter.service_type || 'No service type specified'}</span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">Reason for Visit</h3>
                <div className="flex items-start">
                  <FileText className="h-4 w-4 mr-2 mt-0.5 text-muted-foreground" />
                  <span>{encounter.reason || 'No reason specified'}</span>
                </div>
              </div>

              {encounter.encounter_type === 'inpatient' && (
                <div>
                  <h3 className="text-sm font-medium mb-1">Admission Source</h3>
                  <div className="flex items-center">
                    <Clipboard className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span>{encounter.admission_source ? getAdmissionSourceText(encounter.admission_source) : 'Not specified'}</span>
                  </div>
                </div>
              )}

              {encounter.status === 'finished' && encounter.encounter_type === 'inpatient' && (
                <div>
                  <h3 className="text-sm font-medium mb-1">Discharge Disposition</h3>
                  <div className="flex items-center">
                    <ClipboardList className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span>{encounter.discharge_disposition ? getDischargeDispositionText(encounter.discharge_disposition) : 'Not specified'}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
        <CardFooter className="border-t pt-6">
          <div className="flex items-center text-sm text-muted-foreground">
            <CalendarClock className="h-4 w-4 mr-2" />
            <span>Created: {formatDate(encounter.created_at)}</span>
            {encounter.updated_at && encounter.updated_at !== encounter.created_at && (
              <>
                <span className="mx-2">•</span>
                <span>Last updated: {formatDate(encounter.updated_at)}</span>
              </>
            )}
          </div>
        </CardFooter>
      </Card>

      <Tabs defaultValue="timeline" className="mt-6">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="vitals">Vitals</TabsTrigger>
          <TabsTrigger value="diagnoses">Diagnoses</TabsTrigger>
          <TabsTrigger value="medications">Medications</TabsTrigger>
          <TabsTrigger value="procedures">Procedures</TabsTrigger>
        </TabsList>
        <TabsContent value="timeline" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Encounter Timeline</CardTitle>
              <CardDescription>History of events for this encounter</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-start">
                  <div className="mr-4 mt-1">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                  </div>
                  <div>
                    <div className="font-medium">Encounter Created</div>
                    <div className="text-sm text-muted-foreground">{formatDate(encounter.created_at)}</div>
                  </div>
                </div>
                {encounter.status === 'in-progress' && (
                  <div className="flex items-start">
                    <div className="mr-4 mt-1">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    </div>
                    <div>
                      <div className="font-medium">Encounter Started</div>
                      <div className="text-sm text-muted-foreground">{formatDate(encounter.start_time)}</div>
                    </div>
                  </div>
                )}
                {encounter.status === 'finished' && (
                  <>
                    <div className="flex items-start">
                      <div className="mr-4 mt-1">
                        <div className="h-2 w-2 rounded-full bg-primary" />
                      </div>
                      <div>
                        <div className="font-medium">Encounter Started</div>
                        <div className="text-sm text-muted-foreground">{formatDate(encounter.start_time)}</div>
                      </div>
                    </div>
                    <div className="flex items-start">
                      <div className="mr-4 mt-1">
                        <div className="h-2 w-2 rounded-full bg-primary" />
                      </div>
                      <div>
                        <div className="font-medium">Encounter Completed</div>
                        <div className="text-sm text-muted-foreground">{formatDate(encounter.end_time)}</div>
                      </div>
                    </div>
                  </>
                )}
                {encounter.status === 'cancelled' && (
                  <div className="flex items-start">
                    <div className="mr-4 mt-1">
                      <div className="h-2 w-2 rounded-full bg-destructive" />
                    </div>
                    <div>
                      <div className="font-medium">Encounter Cancelled</div>
                      <div className="text-sm text-muted-foreground">{formatDate(encounter.end_time)}</div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="notes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Clinical Notes</CardTitle>
              <CardDescription>Notes and observations for this encounter</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">No notes have been added to this encounter.</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="vitals" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Vital Signs</CardTitle>
              <CardDescription>Patient vital signs recorded during this encounter</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">No vital signs have been recorded for this encounter.</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="diagnoses" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Diagnoses</CardTitle>
              <CardDescription>Diagnoses associated with this encounter</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">No diagnoses have been recorded for this encounter.</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="medications" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Medications</CardTitle>
              <CardDescription>Medications prescribed during this encounter</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">No medications have been prescribed for this encounter.</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="procedures" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Procedures</CardTitle>
              <CardDescription>Procedures performed during this encounter</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">No procedures have been recorded for this encounter.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Discharge Dialog */}
      <AlertDialog open={showDischargeDialog} onOpenChange={setShowDischargeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discharge Patient</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to discharge this patient? This will mark the encounter as finished.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionInProgress}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDischarge}
              disabled={actionInProgress}
            >
              {actionInProgress ? 'Processing...' : 'Discharge Patient'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Encounter</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this encounter? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionInProgress}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleCancel}
              disabled={actionInProgress}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionInProgress ? 'Processing...' : 'Cancel Encounter'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Helper function to get admission source text
function getAdmissionSourceText(code) {
  const sources = {
    'hosp-trans': 'Transferred from another hospital',
    'emd': 'From emergency department',
    'outp': 'From outpatient department',
    'born': 'Born in hospital',
    'gp': 'General Practitioner referral',
    'mp': 'Medical Practitioner/physician referral',
    'nursing': 'From nursing home',
    'psych': 'From psychiatric hospital',
    'rehab': 'From rehabilitation facility',
    'other': 'Other'
  };
  
  return sources[code] || code;
}

// Helper function to get discharge disposition text
function getDischargeDispositionText(code) {
  const dispositions = {
    'home': 'Discharged to home',
    'alt-home': 'Discharged to alternative home',
    'other-hcf': 'Discharged to other healthcare facility',
    'hosp': 'Discharged to hospital',
    'long': 'Discharged to long-term care',
    'aadvice': 'Left against advice',
    'exp': 'Expired',
    'psy': 'Psychiatric hospital',
    'rehab': 'Rehabilitation facility',
    'snf': 'Skilled nursing facility',
    'other': 'Other'
  };
  
  return dispositions[code] || code;
}