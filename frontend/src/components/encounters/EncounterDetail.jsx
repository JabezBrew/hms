import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { format, parseISO, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useNoteEntriesForEncounter } from '@/hooks/useClinicalNotesQueries';
import { fetchEncounter, dischargeEncounter, cancelEncounter } from '@/lib/api';
import { TimelineEntry } from '@/components/chronicle';
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
  FileText,
  Edit,
  CheckCircle,
  XCircle,
  ChevronLeft,
  Stethoscope,
  MapPin,
  Activity,
  AlertTriangle,
  ExternalLink
} from 'lucide-react';

/**
 * EncounterDetail - Chronicle-style encounter view
 *
 * Clean, single-page layout aligned with PatientChroniclePage:
 * - Hero header with encounter identity
 * - Encounter information section
 * - Timeline entries for this encounter
 * - Actions (discharge, cancel)
 *
 * Removed from old version:
 * - ViewMode switching (Documentation/Review/Monitoring modes)
 * - Tab-based content navigation
 * - Redundant card layouts
 */
export function EncounterDetail({ encounter: initialEncounter, loading: initialLoading, isError }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [encounter, setEncounter] = useState(initialEncounter ?? null);
  const [showDischargeDialog, setShowDischargeDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [error, setError] = useState(null);

  // Fetch clinical notes for this encounter
  const {
    data: clinicalNotes = [],
    isLoading: isLoadingNotes
  } = useNoteEntriesForEncounter(id);

  // Update encounter when props change
  useEffect(() => {
    if (initialEncounter) {
      setEncounter(initialEncounter);
    }
  }, [initialEncounter]);

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return null;
    try {
      const date = parseISO(dateString);
      return isValid(date) ? format(date, 'MMM d, yyyy h:mm a') : null;
    } catch {
      return null;
    }
  };

  const formatDateShort = (dateString) => {
    if (!dateString) return null;
    try {
      const date = parseISO(dateString);
      return isValid(date) ? format(date, 'MMM d, yyyy') : null;
    } catch {
      return null;
    }
  };

  // Get status config
  const getStatusConfig = (status) => {
    const configs = {
      'planned': {
        label: 'Planned',
        badgeClass: 'bg-muted text-muted-foreground border-border',
        icon: Clock
      },
      'in-progress': {
        label: 'In Progress',
        badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
        icon: Activity
      },
      'finished': {
        label: 'Completed',
        badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
        icon: CheckCircle
      },
      'cancelled': {
        label: 'Cancelled',
        badgeClass: 'bg-destructive/10 text-destructive border-destructive/30',
        icon: XCircle
      }
    };
    return configs[status] || configs['planned'];
  };

  // Get encounter type config
  const getTypeConfig = (type) => {
    const configs = {
      'inpatient': {
        label: 'Inpatient Admission',
        shortLabel: 'Inpatient',
        badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
        icon: Building2
      },
      'outpatient': {
        label: 'Outpatient Visit',
        shortLabel: 'Outpatient',
        badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
        icon: Calendar
      },
      'emergency': {
        label: 'Emergency Visit',
        shortLabel: 'Emergency',
        badgeClass: 'bg-destructive/10 text-destructive border-destructive/30',
        icon: AlertTriangle
      }
    };
    return configs[type] || configs['outpatient'];
  };

  // Transform clinical notes to timeline entries
  const timelineEntries = useMemo(() => {
    if (!clinicalNotes || clinicalNotes.length === 0) return [];

    return clinicalNotes.map(note => ({
      id: note.id,
      type: note.note_type || 'progress_note',
      title: note.title,
      content: note.content,
      timestamp: note.created_at,
      author: note.author_name,
      data: note
    }));
  }, [clinicalNotes]);

  // Handle discharge patient
  const handleDischarge = async () => {
    try {
      setActionInProgress(true);
      await dischargeEncounter(id, {
        discharge_disposition: 'home',
        destination: 'Home'
      });
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

  // Loading state
  if (initialLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="bg-card border-b border-border px-4 sm:px-6 py-6 sm:py-8">
          <Skeleton className="h-8 w-32 mb-4" />
          <Skeleton className="h-10 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // Error state
  if (isError || error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <XCircle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="font-display text-xl text-foreground">Unable to load encounter</h2>
          <p className="text-muted-foreground text-sm">{error || 'Please try again'}</p>
          <Button variant="outline" onClick={() => navigate('/encounters')}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back to Encounters
          </Button>
        </div>
      </div>
    );
  }

  // Not found state
  if (!encounter) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <FileText className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="font-display text-xl text-foreground">Encounter not found</h2>
          <p className="text-muted-foreground text-sm">The requested encounter could not be found.</p>
          <Button variant="outline" onClick={() => navigate('/encounters')}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Back to Encounters
          </Button>
        </div>
      </div>
    );
  }

  const statusConfig = getStatusConfig(encounter.status);
  const typeConfig = getTypeConfig(encounter.encounter_type);
  const StatusIcon = statusConfig.icon;
  const TypeIcon = typeConfig.icon;

  const canEdit = encounter.status === 'planned' || encounter.status === 'in-progress';
  const canDischarge = encounter.encounter_type === 'inpatient' &&
                      encounter.status === 'in-progress' &&
                      !encounter.end_time;
  const canCancel = encounter.status === 'planned' || encounter.status === 'in-progress';

  return (
    <div className="min-h-screen bg-background">
      {/* Encounter Identity Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
          {/* Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/encounters')}
              className="self-start -ml-2"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Encounters
            </Button>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/encounters/${id}/edit`)}
                >
                  <Edit className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">Edit</span>
                </Button>
              )}
              {canDischarge && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDischargeDialog(true)}
                  className="text-emerald-600 hover:text-emerald-600 hover:bg-emerald-500/10"
                >
                  <CheckCircle className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Discharge</span>
                </Button>
              )}
              {canCancel && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCancelDialog(true)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <XCircle className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Cancel</span>
                </Button>
              )}
            </div>
          </div>

          {/* Encounter Identity */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            {/* Type Icon */}
            <div className={cn(
              "w-14 h-14 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0",
              typeConfig.badgeClass.replace('text-', 'bg-').replace('/10', '/20')
            )}>
              <TypeIcon className="h-7 w-7 sm:h-8 sm:w-8 text-foreground/70" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h1 className="font-display text-xl sm:text-2xl lg:text-3xl text-foreground tracking-tight">
                  {typeConfig.label}
                </h1>
                <span className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium",
                  statusConfig.badgeClass
                )}>
                  <StatusIcon className="h-3 w-3" />
                  {statusConfig.label}
                </span>
              </div>

              {/* Patient Link */}
              {encounter.patient_name && (
                <Link
                  to={`/patients/${encounter.patient}`}
                  className="inline-flex items-center gap-2 text-primary hover:underline mb-2"
                >
                  <User className="h-4 w-4" />
                  <span className="font-medium">{encounter.patient_name}</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}

              {/* Meta info */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {encounter.practitioner_name && (
                  <span className="flex items-center gap-1.5">
                    <Stethoscope className="h-3.5 w-3.5" />
                    {encounter.practitioner_name}
                  </span>
                )}
                {encounter.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    {encounter.location}
                  </span>
                )}
                {encounter.start_time && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatDateShort(encounter.start_time)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Encounter Details */}
        <section>
          <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Details
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
            <InfoItem
              label="Start Time"
              value={formatDate(encounter.start_time)}
              icon={Clock}
            />
            <InfoItem
              label="End Time"
              value={formatDate(encounter.end_time) || 'Ongoing'}
              icon={Clock}
            />
            <InfoItem
              label="Service Type"
              value={encounter.service_type}
              icon={Activity}
            />
            <InfoItem
              label="Reason"
              value={encounter.reason}
              icon={FileText}
              className="col-span-2 sm:col-span-1"
            />
          </div>

          {/* Diagnosis if available */}
          {encounter.diagnosis && (
            <div className="mt-4 p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
              <h3 className="font-mono text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Diagnosis
              </h3>
              <p className="text-foreground">{encounter.diagnosis}</p>
            </div>
          )}
        </section>

        {/* Timeline / Clinical Notes */}
        <section>
          <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            Clinical Notes
            {timelineEntries.length > 0 && (
              <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded ml-2">
                {timelineEntries.length}
              </span>
            )}
          </h2>

          {isLoadingNotes ? (
            <div className="space-y-4">
              {[1, 2].map(i => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          ) : timelineEntries.length === 0 ? (
            <div className="p-8 rounded-xl sm:rounded-2xl bg-card/50 border border-dashed border-border text-center">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No clinical notes for this encounter</p>
            </div>
          ) : (
            <div className="space-y-3">
              {timelineEntries.map((entry, index) => (
                <TimelineEntry
                  key={entry.id}
                  entry={entry}
                  index={index}
                />
              ))}
            </div>
          )}
        </section>

        {/* Quick Actions */}
        <section className="pt-4 border-t border-border">
          <div className="flex flex-wrap gap-2">
            {encounter.patient && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/patients/${encounter.patient}`)}
              >
                <User className="h-4 w-4 mr-2" />
                View Patient Record
              </Button>
            )}
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/encounters/${id}/edit`)}
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit Encounter
              </Button>
            )}
          </div>
        </section>
      </main>

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
              className="bg-emerald-600 hover:bg-emerald-700"
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

/**
 * InfoItem - Reusable info display component
 */
function InfoItem({ label, value, icon: Icon, className }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <p className="font-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="text-sm sm:text-base text-foreground truncate">
        {value || <span className="text-muted-foreground">—</span>}
      </p>
    </div>
  );
}
