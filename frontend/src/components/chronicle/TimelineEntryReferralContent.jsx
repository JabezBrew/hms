import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';

import { cn } from '@/lib/utils';

const getStatusColor = (status) => {
  switch (status) {
    case 'completed':
      return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20';
    case 'accepted':
    case 'scheduled':
      return 'text-sky-600 bg-sky-50 dark:bg-sky-900/20';
    case 'pending':
      return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20';
    case 'declined':
      return 'text-rose-600 bg-rose-50 dark:bg-rose-900/20';
    default:
      return 'text-muted-foreground bg-muted';
  }
};

export const ReferralContent = ({ referral }) => {
  if (!referral) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {referral.referral_number}
          </span>
          {referral.is_urgent && (
            <span className="badge-chronicle-rose text-[10px]">URGENT</span>
          )}
        </div>
        <span className={cn(
          'font-mono text-xs px-2 py-0.5 rounded-full',
          getStatusColor(referral.status)
        )}>
          {referral.status_display}
        </span>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {referral.referring_department}
        </span>
        <ArrowRight className="size-4 text-muted-foreground/50" />
        <span className="font-medium text-foreground/90">
          {referral.referred_to_specialty || referral.referred_to_department}
        </span>
        {referral.referred_to_provider && (
          <span className="text-muted-foreground">
            ({referral.referred_to_provider})
          </span>
        )}
      </div>

      {referral.status === 'completed' && referral.specialist_notes ? (
        <div className="p-3 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-lg border border-emerald-200/50 dark:border-emerald-900/30">
          <p className="font-mono text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">
            Specialist Notes
          </p>
          <p className="text-sm text-foreground/80 line-clamp-3">
            {referral.specialist_notes}
          </p>
          {referral.recommendations && (
            <>
              <p className="font-mono text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mt-2 mb-1">
                Recommendations
              </p>
              <p className="text-sm text-foreground/80 line-clamp-2">
                {referral.recommendations}
              </p>
            </>
          )}
        </div>
      ) : referral.reason && (
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground/70 mb-1">
            Reason for Referral
          </p>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {referral.reason}
          </p>
        </div>
      )}

      {referral.status !== 'completed' && referral.questions_for_specialist && (
        <div className="p-2 bg-amber-50/50 dark:bg-amber-900/10 rounded-lg border border-amber-200/50 dark:border-amber-900/30">
          <p className="font-mono text-xs uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Questions for Specialist
          </p>
          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
            {referral.questions_for_specialist}
          </p>
        </div>
      )}
    </div>
  );
};
