import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, parseISO, isValid } from 'date-fns';
import { fetchEncounter, dischargeEncounter, cancelEncounter } from '@/lib/api';
import { useNoteEntriesForEncounter } from '@/hooks/useClinicalNotesQueries';
import { useViewMode, VIEW_MODES } from '@/contexts/ViewModeContext';
import { ViewModeSwitcher } from './ViewModeSwitcher';
import { DocumentationModeLayout } from './layouts/DocumentationModeLayout';
import { ReviewModeLayout } from './layouts/ReviewModeLayout';
import { MonitoringModeLayout } from './layouts/MonitoringModeLayout';
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
  const { viewMode } = useViewMode();
  const [loading, setLoading] = useState(initialLoading ?? true);
  const [encounter, setEncounter] = useState(initialEncounter ?? null);
  const [error, setError] = useState(null);
  const [showDischargeDialog, setShowDischargeDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);

  // Fetch clinical notes for this encounter
  const {
    data: clinicalNotes,
    isLoading: isLoadingNotes
  } = useNoteEntriesForEncounter(id);

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

  // Render the appropriate layout based on view mode
  const renderLayout = () => {
    const layoutProps = {
      encounter,
      formatDate,
      getStatusBadge,
      getTypeBadge,
      clinicalNotes,
      isLoadingNotes,
    };

    switch (viewMode) {
      case VIEW_MODES.REVIEW:
        return <ReviewModeLayout {...layoutProps} />;
      case VIEW_MODES.MONITORING:
        return <MonitoringModeLayout {...layoutProps} />;
      case VIEW_MODES.DOCUMENTATION:
      default:
        return <DocumentationModeLayout {...layoutProps} />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="icon" onClick={() => navigate('/encounters')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Encounter Details</h1>
        </div>
        <div className="flex items-center space-x-2">
          {/* View Mode Switcher */}
          <ViewModeSwitcher />

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

      {/* Render layout based on view mode */}
      {renderLayout()}

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
