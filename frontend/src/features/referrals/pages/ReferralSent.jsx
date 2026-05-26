import User from 'lucide-react/dist/esm/icons/user.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import format from 'date-fns/format';
import {
  useReferralsSent,
  useReferralSlaDashboard,
  useReferralSlaState,
} from '@/features/referrals/hooks';
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

  const acceptanceNotes =
    referral.acceptance_notes ||
    extractAcceptanceNotes(referral.specialist_notes);

  return {
    ...referral,
    patientName,
    patientMrn,
    acceptanceNotes,
  };
};

const ReferralSent = () => {
  const { search: searchQuery, updateSearch, hasActiveFilters } = useListFilters();
  const [selectedReferral, setSelectedReferral] = useState(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  const { data: sentData, isLoading } = useReferralsSent();
  const { data: slaDashboard } = useReferralSlaDashboard();

  const normalizedReferrals = useMemo(
    () => (sentData?.referrals || []).map(normalizeReferral),
    [sentData?.referrals]
  );

  const filteredReferrals = useMemo(() => {
    return normalizedReferrals.filter((referral) => {
      if (!searchQuery) return true;

      const query = searchQuery.toLowerCase();
      return (
        referral.patientName.toLowerCase().includes(query) ||
        referral.patientMrn.toLowerCase().includes(query) ||
        (referral.referral_number || '').toLowerCase().includes(query) ||
        (referral.referred_to_department || '').toLowerCase().includes(query) ||
        (referral.reason || '').toLowerCase().includes(query)
      );
    });
  }, [normalizedReferrals, searchQuery]);

  const statusCounts = useMemo(() => {
    return normalizedReferrals.reduce((acc, referral) => {
      acc[referral.status] = (acc[referral.status] || 0) + 1;
      return acc;
    }, {});
  }, [normalizedReferrals]);

  const breachedCount = slaDashboard?.risk_summary?.breached || 0;

  const shouldFetchSelectedSla = Boolean(
    detailDialogOpen &&
    selectedReferral?.id &&
    ['pending', 'accepted', 'scheduled'].includes(selectedReferral?.status)
  );

  const { data: selectedReferralSla } = useReferralSlaState(selectedReferral?.id, {
    enabled: shouldFetchSelectedSla,
  });

  const handleViewDetails = (referral) => {
    setSelectedReferral(referral);
    setDetailDialogOpen(true);
  };

  const statusConfig = {
    draft: {
      label: 'Draft',
      badgeClass: 'bg-muted text-muted-foreground',
      icon: FileText,
      description: 'Not yet submitted',
    },
    pending: {
      label: 'Pending Review',
      badgeClass: 'badge-chronicle-amber',
      icon: Clock,
      description: 'Waiting for specialist response',
    },
    accepted: {
      label: 'Accepted',
      badgeClass: 'badge-chronicle-emerald',
      icon: CheckCircle,
      description: 'Specialist has accepted',
    },
    declined: {
      label: 'Declined',
      badgeClass: 'badge-chronicle-rose',
      icon: XCircle,
      description: 'Specialist declined',
    },
    scheduled: {
      label: 'Scheduled',
      badgeClass: 'badge-chronicle-sky',
      icon: Calendar,
      description: 'Appointment scheduled',
    },
    completed: {
      label: 'Completed',
      badgeClass: 'badge-chronicle-emerald',
      icon: CheckCircle,
      description: 'Consultation completed',
    },
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

  const progressionSteps = [
    { key: 'draft', label: 'Created', icon: FileText },
    { key: 'pending', label: 'Submitted', icon: Send },
    { key: 'accepted', label: 'Accepted', icon: CheckCircle },
    { key: 'scheduled', label: 'Scheduled', icon: Calendar },
    { key: 'completed', label: 'Completed', icon: Stethoscope },
  ];

  const getStepIndex = (status) => {
    if (status === 'declined') return -1;
    const index = progressionSteps.findIndex((step) => step.key === status);
    return index >= 0 ? index : 0;
  };

  const selectedSlaState = selectedReferralSla?.sla_state || null;

  if (isLoading) {
    return (
      <PageShell>
        <PageHeader
          title="Sent Referrals"
          description="Track the status of referrals you've sent to specialists"
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
        title="Sent Referrals"
        description="Track the status of referrals you've sent to specialists"
        actions={(
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <span className="badge-chronicle-amber text-base px-3 py-1">
              {filteredReferrals.length} Referrals
            </span>
            <span className="badge-chronicle-rose text-base px-3 py-1">
              {breachedCount} SLA Breached
            </span>
          </div>
        )}
      />

      <div className="p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.entries(statusConfig).map(([status, config]) => {
            const count = statusCounts[status] || 0;
            return (
              <Card key={status} className="bg-card border-border">
                <CardContent className="pt-4 pb-3">
                  <div className="text-center">
                    <div className="font-mono text-2xl font-bold text-foreground mb-1">
                      {count}
                    </div>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full', config.badgeClass)}>
                      {config.label}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by patient name, MRN, department, or reason..."
            value={searchQuery}
            onChange={(e) => updateSearch(e.target.value)}
            className="pl-10 bg-card border-border"
          />
        </div>

        {filteredReferrals.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <Send className="size-12 mx-auto mb-3 opacity-50" />
                <p className="font-heading font-medium">No referrals found</p>
                <p className="text-sm mt-1">
                  {hasActiveFilters
                    ? 'Try adjusting your search'
                    : 'Referrals you send will appear here'}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredReferrals.map((referral) => {
              const status = statusConfig[referral.status] || statusConfig.draft;
              const urgency = urgencyConfig[referral.urgency] || urgencyConfig.routine;
              const StatusIcon = status.icon;
              const UrgencyIcon = urgency.icon;

              return (
                <Card key={referral.id} className="bg-card border-border animate-chronicle-enter">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <CardTitle className="font-heading text-lg text-foreground">
                            Referral #{referral.referral_number}
                          </CardTitle>
                          <span className={cn('gap-1 inline-flex items-center text-xs px-2 py-0.5 rounded-full', status.badgeClass)}>
                            <StatusIcon className="size-3" />
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
                          <div className="flex items-center gap-2 text-muted-foreground">
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewDetails(referral)}
                        className="font-mono text-xs"
                      >
                        <Eye className="size-4 mr-2" />
                        View Details
                      </Button>
                    </div>
                  </CardHeader>

                  {referral.status !== 'declined' && (
                    <div className="px-6 py-3 border-t border-border bg-muted/30">
                      <div className="flex items-center justify-between">
                        {progressionSteps.map((step, index) => {
                          const StepIcon = step.icon;
                          const currentIndex = getStepIndex(referral.status);
                          const isCompleted = index <= currentIndex;
                          const isCurrent = index === currentIndex;

                          return (
                            <div key={step.key} className="flex items-center flex-1">
                              <div className="flex flex-col items-center">
                                <div
                                  className={cn(
                                    'size-8 rounded-full flex items-center justify-center transition-all',
                                    isCompleted
                                      ? 'bg-emerald-500 text-white'
                                      : 'bg-muted text-muted-foreground',
                                    isCurrent && 'ring-2 ring-emerald-500/50 ring-offset-2 ring-offset-background'
                                  )}
                                >
                                  <StepIcon className="size-4" />
                                </div>
                                <span
                                  className={cn(
                                    'font-mono text-[10px] mt-1 text-center',
                                    isCompleted ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                                  )}
                                >
                                  {step.label}
                                </span>
                              </div>
                              {index < progressionSteps.length - 1 && (
                                <div
                                  className={cn(
                                    'flex-1 h-0.5 mx-2 transition-colors',
                                    index < currentIndex ? 'bg-emerald-500' : 'bg-muted'
                                  )}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {referral.status === 'declined' && (
                    <div className="px-6 py-3 border-t border-border bg-rose-50/50 dark:bg-rose-900/10">
                      <div className="flex items-center gap-2">
                        <XCircle className="size-4 text-rose-500" />
                        <span className="text-sm font-medium text-rose-600 dark:text-rose-400">
                          Referral Declined
                        </span>
                        {referral.decline_reason && (
                          <span className="text-sm text-muted-foreground ml-2">
                            : {referral.decline_reason.slice(0, 50)}
                            {referral.decline_reason.length > 50 ? '...' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-sm font-heading font-medium text-foreground mb-1 flex items-center gap-1">
                        <FileText className="size-3" />
                        Reason:
                      </p>
                      <p className="text-sm text-muted-foreground">{referral.reason}</p>
                    </div>

                    {referral.status === 'pending' && (
                      <div className="bg-[oklch(0.75_0.18_55_/_0.1)] border border-[oklch(0.75_0.18_55_/_0.3)] rounded-lg p-3">
                        <p className="text-xs text-[oklch(0.75_0.18_55)]">
                          <Clock className="inline size-3 mr-1" />
                          Awaiting specialist response
                        </p>
                      </div>
                    )}

                    {referral.status === 'accepted' && referral.acceptanceNotes && (
                      <div className="bg-[oklch(0.70_0.17_155_/_0.1)] border border-[oklch(0.70_0.17_155_/_0.3)] rounded-lg p-3">
                        <p className="text-xs font-heading font-medium text-[oklch(0.70_0.17_155)] mb-1">
                          Specialist Response:
                        </p>
                        <p className="text-sm text-foreground">
                          {referral.acceptanceNotes}
                        </p>
                      </div>
                    )}

                    {referral.status === 'declined' && referral.decline_reason && (
                      <div className="bg-[oklch(0.65_0.22_15_/_0.1)] border border-[oklch(0.65_0.22_15_/_0.3)] rounded-lg p-3">
                        <p className="text-xs font-heading font-medium text-[oklch(0.65_0.22_15)] mb-1">
                          Decline Reason:
                        </p>
                        <p className="text-sm text-foreground">{referral.decline_reason}</p>
                      </div>
                    )}

                    {referral.status === 'completed' && (
                      <div className="space-y-2">
                        {referral.specialist_notes && (
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
                      </div>
                    )}

                    {referral.updated_at && (
                      <div className="font-mono text-xs text-muted-foreground">
                        Last updated: {format(new Date(referral.updated_at), 'MMM dd, yyyy HH:mm')}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">
                Referral #{selectedReferral?.referral_number}
              </DialogTitle>
              <DialogDescription>
                Complete referral details and specialist responses
              </DialogDescription>
            </DialogHeader>

            {selectedReferral && (
              <div className="space-y-6 py-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full', statusConfig[selectedReferral.status]?.badgeClass)}>
                    {statusConfig[selectedReferral.status]?.label}
                  </span>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full', urgencyConfig[selectedReferral.urgency]?.badgeClass)}>
                    {urgencyConfig[selectedReferral.urgency]?.label}
                  </span>
                </div>

                {selectedSlaState && (
                  <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-2">
                    <h3 className="font-heading font-semibold text-foreground">SLA Status</h3>
                    <div className="grid gap-2 sm:grid-cols-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Risk band:</span>{' '}
                        <span className="capitalize font-semibold text-foreground">{selectedSlaState.risk_band}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Consumed:</span>{' '}
                        <span className="font-semibold text-foreground">{selectedSlaState.consumed_percent}%</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Remaining:</span>{' '}
                        <span className="font-semibold text-foreground">{selectedSlaState.remaining_hours}h</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Deadline:</span>{' '}
                        <span className="font-mono text-foreground">
                          {selectedSlaState.deadline_at ? format(new Date(selectedSlaState.deadline_at), 'MMM dd, yyyy HH:mm') : 'n/a'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-muted border border-border rounded-lg p-4">
                  <h3 className="font-heading font-semibold text-foreground mb-3">Patient Information</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Name:</span>
                      <span className="font-semibold text-foreground">{selectedReferral.patientName}</span>
                    </div>
                    {selectedReferral.patientMrn && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">MRN:</span>
                        <span className="font-mono text-foreground">{selectedReferral.patientMrn}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Department:</span>
                      <span className="capitalize text-foreground">
                        {selectedReferral.referred_to_department?.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {selectedReferral.referred_to_specialty && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Specialty:</span>
                        <span className="text-foreground">{selectedReferral.referred_to_specialty}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="font-heading font-semibold text-foreground mb-3">Referral Details</h3>
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-heading font-medium text-muted-foreground mb-1">Reason for Referral:</p>
                      <p className="text-sm text-foreground">{selectedReferral.reason}</p>
                    </div>
                    {selectedReferral.clinical_summary && (
                      <div>
                        <p className="text-sm font-heading font-medium text-muted-foreground mb-1">Clinical Summary:</p>
                        <p className="text-sm text-foreground whitespace-pre-wrap">{selectedReferral.clinical_summary}</p>
                      </div>
                    )}
                  </div>
                </div>

                {(selectedReferral.acceptanceNotes ||
                  selectedReferral.decline_reason ||
                  selectedReferral.specialist_notes) && (
                  <div>
                    <h3 className="font-heading font-semibold text-foreground mb-3">Specialist Response</h3>
                    <div className="space-y-3">
                      {selectedReferral.acceptanceNotes && (
                        <div className="bg-[oklch(0.70_0.17_155_/_0.1)] border border-[oklch(0.70_0.17_155_/_0.3)] rounded-lg p-4">
                          <p className="text-sm font-heading font-medium text-[oklch(0.70_0.17_155)] mb-2">Acceptance Notes:</p>
                          <p className="text-sm text-foreground">{selectedReferral.acceptanceNotes}</p>
                        </div>
                      )}
                      {selectedReferral.decline_reason && (
                        <div className="bg-[oklch(0.65_0.22_15_/_0.1)] border border-[oklch(0.65_0.22_15_/_0.3)] rounded-lg p-4">
                          <p className="text-sm font-heading font-medium text-[oklch(0.65_0.22_15)] mb-2">Decline Reason:</p>
                          <p className="text-sm text-foreground">{selectedReferral.decline_reason}</p>
                        </div>
                      )}
                      {selectedReferral.specialist_notes && (selectedReferral.status === 'completed' || !selectedReferral.acceptanceNotes) && (
                        <div className="bg-[oklch(0.70_0.15_230_/_0.1)] border border-[oklch(0.70_0.15_230_/_0.3)] rounded-lg p-4">
                          <p className="text-sm font-heading font-medium text-[oklch(0.70_0.15_230)] mb-2">Specialist Notes:</p>
                          <p className="text-sm text-foreground whitespace-pre-wrap">{selectedReferral.specialist_notes}</p>
                        </div>
                      )}
                      {selectedReferral.recommendations && (
                        <div className="bg-[oklch(0.70_0.15_230_/_0.1)] border border-[oklch(0.70_0.15_230_/_0.3)] rounded-lg p-4">
                          <p className="text-sm font-heading font-medium text-[oklch(0.70_0.15_230)] mb-2">Recommendations:</p>
                          <p className="text-sm text-foreground whitespace-pre-wrap">{selectedReferral.recommendations}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="bg-muted border border-border rounded-lg p-4">
                  <h3 className="font-heading font-semibold text-foreground mb-3">Timeline</h3>
                  <div className="space-y-2 text-sm">
                    {selectedReferral.created_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Created:</span>
                        <span className="font-mono text-foreground">{format(new Date(selectedReferral.created_at), 'MMM dd, yyyy HH:mm')}</span>
                      </div>
                    )}
                    {selectedReferral.updated_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Last Updated:</span>
                        <span className="font-mono text-foreground">{format(new Date(selectedReferral.updated_at), 'MMM dd, yyyy HH:mm')}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </PageShell>
  );
};

export default ReferralSent;
