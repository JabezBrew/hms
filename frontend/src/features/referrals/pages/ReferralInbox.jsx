/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import User from 'lucide-react/dist/esm/icons/user.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import PlayCircle from 'lucide-react/dist/esm/icons/circle-play.js';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.js';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import format from 'date-fns/format';
import {
  useReferralInbox,
  useAcceptReferral,
  useDeclineReferral,
  useCompleteReferral,
  useReferralSlaDashboard,
  useClinicWaitlistSummary,
} from '@/features/referrals/hooks';
import { toast } from 'sonner';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { useListFilters } from '@/shared/hooks/useListFilters';

const extractAcceptanceNotes = (specialistNotes = '') => {
  if (typeof specialistNotes !== 'string') {
    return '';
  }

  const marker = '[Acceptance Notes]';
  if (!specialistNotes.startsWith(marker)) {
    return '';
  }

  return specialistNotes
    .slice(marker.length)
    .trim()
    .split('\n\n')[0]
    .trim();
};

const normalizeReferral = (referral) => {
  const patientName = referral.patient_name || [
    referral.patient_details?.first_name,
    referral.patient_details?.last_name,
  ].filter(Boolean).join(' ').trim() || 'Unknown patient';

  const patientMrn =
    referral.patient_mrn ||
    referral.patient_details?.medical_record_number ||
    '';

  const referringProviderName =
    referral.referring_provider_name ||
    [
      referral.referring_provider_details?.first_name,
      referral.referring_provider_details?.last_name,
    ].filter(Boolean).join(' ').trim() ||
    '';

  const acceptanceNotes =
    referral.acceptance_notes ||
    extractAcceptanceNotes(referral.specialist_notes);

  return {
    ...referral,
    patientName,
    patientMrn,
    referringProviderName,
    acceptanceNotes,
  };
};

/**
 * ReferralInbox - Received referrals management for specialists
 */
const ReferralInbox = () => {
  const navigate = useNavigate();
  const { search: searchQuery, updateSearch, hasActiveFilters } = useListFilters();
  const [selectedReferral, setSelectedReferral] = useState(null);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [currentAction, setCurrentAction] = useState(null);
  const [actionNotes, setActionNotes] = useState('');
  const [recommendations, setRecommendations] = useState('');

  const { data: inboxData, isLoading } = useReferralInbox();
  const { data: slaDashboard } = useReferralSlaDashboard();
  const { data: waitlistSummary } = useClinicWaitlistSummary();
  const acceptReferral = useAcceptReferral();
  const declineReferral = useDeclineReferral();
  const completeReferral = useCompleteReferral();

  const normalizedReferrals = useMemo(
    () => (inboxData?.referrals || []).map(normalizeReferral),
    [inboxData?.referrals]
  );

  const filteredReferrals = useMemo(() => {
    return normalizedReferrals.filter((referral) => {
      if (!searchQuery) return true;

      const query = searchQuery.toLowerCase();
      return (
        referral.patientName.toLowerCase().includes(query) ||
        referral.patientMrn.toLowerCase().includes(query) ||
        (referral.referral_number || '').toLowerCase().includes(query) ||
        (referral.reason || '').toLowerCase().includes(query)
      );
    });
  }, [normalizedReferrals, searchQuery]);

  const waitlistWaitingCount = useMemo(() => {
    const rows = waitlistSummary?.rows || [];
    return rows.reduce((total, row) => total + (row?.total || 0), 0);
  }, [waitlistSummary?.rows]);

  const breachedCount = slaDashboard?.risk_summary?.breached || 0;

  const handleStartConsultation = (referral) => {
    const patientId = referral.patient;
    if (!patientId) {
      toast.error('Unable to navigate', { description: 'Patient ID not found' });
      return;
    }
    navigate(`/patients/${patientId}?action=add_note&referral_id=${referral.id}`);
  };

  const handleActionClick = (referral, action) => {
    setSelectedReferral(referral);
    setCurrentAction(action);
    setActionNotes('');
    setRecommendations('');
    setActionDialogOpen(true);
  };

  const handleActionSubmit = async () => {
    if (!selectedReferral) return;

    try {
      switch (currentAction) {
        case 'accept':
          await acceptReferral.mutateAsync({
            id: selectedReferral.id,
            acceptanceNotes: actionNotes,
          });
          toast.success('Referral accepted', {
            description: `Referral #${selectedReferral.referral_number} has been accepted`,
          });
          break;

        case 'decline':
          if (!actionNotes || actionNotes.trim() === '') {
            toast.error('Please provide a reason for declining');
            return;
          }
          await declineReferral.mutateAsync({
            id: selectedReferral.id,
            declineReason: actionNotes,
          });
          toast.success('Referral declined', {
            description: `Referral #${selectedReferral.referral_number} has been declined`,
          });
          break;

        case 'complete':
          if (!actionNotes || actionNotes.trim() === '') {
            toast.error('Please provide specialist notes');
            return;
          }
          await completeReferral.mutateAsync({
            id: selectedReferral.id,
            specialistNotes: actionNotes,
            recommendations,
          });
          toast.success('Referral completed', {
            description: `Referral #${selectedReferral.referral_number} has been completed`,
          });
          break;

        default:
          break;
      }

      setActionDialogOpen(false);
      setSelectedReferral(null);
      setCurrentAction(null);
    } catch (error) {
      console.error('Error performing action:', error);
      toast.error('Action failed', {
        description: error.message || 'Please try again',
      });
    }
  };

  const statusConfig = {
    draft: { label: 'Draft', badgeClass: 'bg-muted text-muted-foreground' },
    pending: { label: 'Pending Review', badgeClass: 'badge-chronicle-amber' },
    accepted: { label: 'Accepted', badgeClass: 'badge-chronicle-emerald' },
    declined: { label: 'Declined', badgeClass: 'badge-chronicle-rose' },
    scheduled: { label: 'Scheduled', badgeClass: 'badge-chronicle-sky' },
    completed: { label: 'Completed', badgeClass: 'badge-chronicle-emerald' },
  };

  const urgencyConfig = {
    routine: {
      label: 'Routine',
      badgeClass: 'bg-muted text-muted-foreground',
      icon: Clock,
    },
    urgent: {
      label: 'Urgent',
      badgeClass: 'badge-chronicle-amber',
      icon: AlertCircle,
    },
    emergency: {
      label: 'Emergency',
      badgeClass: 'badge-chronicle-rose',
      icon: AlertCircle,
    },
  };

  const actionConfig = {
    accept: {
      title: 'Accept Referral',
      description:
        'Accept this referral and add any notes about scheduling or next steps',
      buttonLabel: 'Accept Referral',
      buttonClass: 'bg-[oklch(0.70_0.17_155)] hover:bg-[oklch(0.65_0.17_155)] text-white',
      notesLabel: 'Acceptance Notes (Optional)',
      notesPlaceholder:
        'Add notes about scheduling, what the patient should bring, or any pre-visit instructions...',
    },
    decline: {
      title: 'Decline Referral',
      description: 'Decline this referral and provide a reason',
      buttonLabel: 'Decline Referral',
      buttonClass: 'bg-[oklch(0.65_0.22_15)] hover:bg-[oklch(0.60_0.22_15)] text-white',
      notesLabel: 'Reason for Declining *',
      notesPlaceholder:
        'Provide a clear reason for declining (e.g., patient needs different specialty, insufficient information, not appropriate for referral)...',
    },
    complete: {
      title: 'Complete Referral',
      description: 'Mark this referral as completed and provide your findings',
      buttonLabel: 'Complete Referral',
      buttonClass: 'bg-[oklch(0.70_0.17_155)] hover:bg-[oklch(0.65_0.17_155)] text-white',
      notesLabel: 'Specialist Notes *',
      notesPlaceholder:
        'Document your findings, diagnosis, treatment plan, and any procedures performed...',
    },
  };

  if (isLoading) {
    return (
      <PageShell>
        <PageHeader
          title="Referral Inbox"
          description="Review and manage referrals sent to your department"
        />
        <div className="flex items-center justify-center py-12">
          <div className="text-muted-foreground">Loading referrals…</div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Referral Inbox"
        description="Review and manage referrals sent to your department"
        actions={(
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <span className="badge-chronicle-amber text-base px-3 py-1">
              {filteredReferrals.length} Referrals
            </span>
            <span className="badge-chronicle-rose text-base px-3 py-1">
              {breachedCount} SLA Breached
            </span>
            <span className="badge-chronicle-sky text-base px-3 py-1">
              {waitlistWaitingCount} Waitlist
            </span>
          </div>
        )}
      />

      <div className="p-4 sm:p-6 space-y-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by patient name, MRN, referral number, or reason..."
            value={searchQuery}
            onChange={(e) => updateSearch(e.target.value)}
            className="pl-10 bg-card border-border"
          />
        </div>

        {filteredReferrals.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <Stethoscope className="size-12 mx-auto mb-3 opacity-50" />
                <p className="font-heading font-medium">No referrals found</p>
                <p className="text-sm mt-1">
                  {hasActiveFilters
                    ? 'Try adjusting your search'
                    : 'Referrals will appear here when sent to your department'}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredReferrals.map((referral) => {
              const status = statusConfig[referral.status] || statusConfig.draft;
              const urgency = urgencyConfig[referral.urgency] || urgencyConfig.routine;
              const UrgencyIcon = urgency.icon;

              return (
                <Card key={referral.id} className="bg-card border-border animate-chronicle-enter">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <CardTitle className="font-heading text-lg text-foreground">
                            Referral #{referral.referral_number}
                          </CardTitle>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full', status.badgeClass)}>
                            {status.label}
                          </span>
                          <span className={cn('gap-1 inline-flex items-center text-xs px-2 py-0.5 rounded-full', urgency.badgeClass)}>
                            <UrgencyIcon className="size-3" />
                            {urgency.label}
                          </span>
                        </div>
                        <CardDescription className="space-y-1">
                          <div className="flex items-center gap-4 flex-wrap text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <User className="size-3" />
                              {referral.patientName}
                            </span>
                            {referral.patientMrn && (
                              <span className="font-mono">
                                MRN: {referral.patientMrn}
                              </span>
                            )}
                            {referral.created_at && (
                              <span className="flex items-center gap-1 font-mono text-xs">
                                <Calendar className="size-3" />
                                {format(new Date(referral.created_at), 'MMM dd, yyyy')}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                            <Building2 className="size-3" />
                            <span className="capitalize">
                              {referral.referred_to_department?.replace(/_/g, ' ')}
                            </span>
                            {referral.referred_to_specialty && referral.referred_to_specialty !== referral.referred_to_department && (
                              <span className="opacity-60">
                                • {referral.referred_to_specialty}
                              </span>
                            )}
                          </div>
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {referral.referringProviderName && (
                      <div className="bg-muted border border-border rounded-lg p-3">
                        <p className="text-xs font-heading font-medium text-muted-foreground mb-1">
                          Referring Provider:
                        </p>
                        <p className="text-sm text-foreground">
                          Dr. {referral.referringProviderName}
                        </p>
                      </div>
                    )}

                    <div>
                      <p className="text-sm font-heading font-medium text-foreground mb-1 flex items-center gap-1">
                        <FileText className="size-3" />
                        Reason for Referral:
                      </p>
                      <p className="text-sm text-muted-foreground">{referral.reason}</p>
                    </div>

                    {referral.clinical_summary && (
                      <div>
                        <p className="text-sm font-heading font-medium text-foreground mb-1">
                          Clinical Summary:
                        </p>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {referral.clinical_summary}
                        </p>
                      </div>
                    )}

                    {referral.acceptanceNotes && (
                      <div className="bg-[oklch(0.70_0.17_155_/_0.1)] border border-[oklch(0.70_0.17_155_/_0.3)] rounded-lg p-3">
                        <p className="text-xs font-heading font-medium text-[oklch(0.70_0.17_155)] mb-1">
                          Acceptance Notes:
                        </p>
                        <p className="text-sm text-foreground">
                          {referral.acceptanceNotes}
                        </p>
                      </div>
                    )}

                    {referral.decline_reason && (
                      <div className="bg-[oklch(0.65_0.22_15_/_0.1)] border border-[oklch(0.65_0.22_15_/_0.3)] rounded-lg p-3">
                        <p className="text-xs font-heading font-medium text-[oklch(0.65_0.22_15)] mb-1">
                          Decline Reason:
                        </p>
                        <p className="text-sm text-foreground">{referral.decline_reason}</p>
                      </div>
                    )}

                    {referral.specialist_notes && (referral.status === 'completed' || !referral.acceptanceNotes) && (
                      <div className="bg-[oklch(0.70_0.15_230_/_0.1)] border border-[oklch(0.70_0.15_230_/_0.3)] rounded-lg p-3">
                        <p className="text-xs font-heading font-medium text-[oklch(0.70_0.15_230)] mb-1">
                          Specialist Notes:
                        </p>
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {referral.specialist_notes}
                        </p>
                      </div>
                    )}

                    {referral.recommendations && (
                      <div className="bg-[oklch(0.70_0.15_230_/_0.1)] border border-[oklch(0.70_0.15_230_/_0.3)] rounded-lg p-3">
                        <p className="text-xs font-heading font-medium text-[oklch(0.70_0.15_230)] mb-1">
                          Recommendations:
                        </p>
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {referral.recommendations}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-2 flex-wrap">
                      {referral.status === 'pending' && (
                        <>
                          <Button
                            onClick={() => handleActionClick(referral, 'accept')}
                            className="bg-[oklch(0.70_0.17_155)] hover:bg-[oklch(0.65_0.17_155)] text-white font-mono text-xs"
                          >
                            <CheckCircle className="size-4 mr-2" />
                            Accept
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => handleActionClick(referral, 'decline')}
                            className="border-[oklch(0.65_0.22_15_/_0.5)] text-[oklch(0.65_0.22_15)] hover:bg-[oklch(0.65_0.22_15_/_0.1)] font-mono text-xs"
                          >
                            <XCircle className="size-4 mr-2" />
                            Decline
                          </Button>
                        </>
                      )}
                      {referral.status === 'accepted' && (
                        <>
                          <Button
                            onClick={() => handleStartConsultation(referral)}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground font-mono text-xs"
                          >
                            <PlayCircle className="size-4 mr-2" />
                            Start Consultation
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => handleActionClick(referral, 'complete')}
                            className="font-mono text-xs"
                          >
                            <MessageSquare className="size-4 mr-2" />
                            Quick Response
                          </Button>
                        </>
                      )}
                      {referral.status === 'scheduled' && (
                        <>
                          <Button
                            onClick={() => handleStartConsultation(referral)}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground font-mono text-xs"
                          >
                            <Stethoscope className="size-4 mr-2" />
                            View Patient
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => handleActionClick(referral, 'complete')}
                            className="font-mono text-xs"
                          >
                            <CheckCircle className="size-4 mr-2" />
                            Complete Referral
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
          <DialogContent className="max-w-2xl bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">{actionConfig[currentAction]?.title}</DialogTitle>
              <DialogDescription>
                {actionConfig[currentAction]?.description}
              </DialogDescription>
            </DialogHeader>

            {selectedReferral && (
              <div className="py-4 space-y-4">
                <div className="bg-muted border border-border rounded-lg p-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Referral Number:</span>
                      <span className="font-mono font-semibold text-foreground">
                        #{selectedReferral.referral_number}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Patient:</span>
                      <span className="font-semibold text-foreground">{selectedReferral.patientName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Reason:</span>
                      <span className="font-semibold text-foreground">{selectedReferral.reason}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="action_notes" className="font-heading">
                    {actionConfig[currentAction]?.notesLabel}
                  </Label>
                  <Textarea
                    id="action_notes"
                    placeholder={actionConfig[currentAction]?.notesPlaceholder}
                    value={actionNotes}
                    onChange={(e) => setActionNotes(e.target.value)}
                    className="min-h-[120px] bg-background border-border"
                  />
                </div>

                {currentAction === 'complete' && (
                  <div className="space-y-2">
                    <Label htmlFor="recommendations" className="font-heading">
                      Recommendations for Referring Provider (Optional)
                    </Label>
                    <Textarea
                      id="recommendations"
                      placeholder="Follow-up care, medication adjustments, further testing needed, etc..."
                      value={recommendations}
                      onChange={(e) => setRecommendations(e.target.value)}
                      className="min-h-[100px] bg-background border-border"
                    />
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setActionDialogOpen(false)}
                disabled={
                  acceptReferral.isPending ||
                  declineReferral.isPending ||
                  completeReferral.isPending
                }
                className="font-mono text-xs"
              >
                Cancel
              </Button>
              <Button
                onClick={handleActionSubmit}
                disabled={
                  acceptReferral.isPending ||
                  declineReferral.isPending ||
                  completeReferral.isPending
                }
                className={cn('font-mono text-xs', actionConfig[currentAction]?.buttonClass)}
              >
                {acceptReferral.isPending ||
                declineReferral.isPending ||
                completeReferral.isPending
                  ? 'Processing...'
                  : actionConfig[currentAction]?.buttonLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageShell>
  );
};

export default ReferralInbox;
