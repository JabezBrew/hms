const STATUS_CONFIG = {
  checked_in: {
    label: 'Checked In',
    color: 'sky',
    bgClass: 'bg-sky-500/10',
    textClass: 'text-sky-400',
    borderClass: 'border-sky-500/30',
  },
  waiting: {
    label: 'Waiting',
    color: 'amber',
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-400',
    borderClass: 'border-amber-500/30',
  },
  called: {
    label: 'Called',
    color: 'amber',
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-400',
    borderClass: 'border-amber-500/30',
    pulse: true,
  },
  in_progress: {
    label: 'With Doctor',
    color: 'emerald',
    bgClass: 'bg-emerald-500/10',
    textClass: 'text-emerald-400',
    borderClass: 'border-emerald-500/30',
  },
  on_hold: {
    label: 'On Hold',
    color: 'rose',
    bgClass: 'bg-rose-500/10',
    textClass: 'text-rose-400',
    borderClass: 'border-rose-500/30',
  },
  ready_checkout: {
    label: 'Ready for Checkout',
    color: 'sky',
    bgClass: 'bg-sky-500/10',
    textClass: 'text-sky-400',
    borderClass: 'border-sky-500/30',
  },
  checked_out: {
    label: 'Checked Out',
    color: 'muted',
    bgClass: 'bg-muted/50',
    textClass: 'text-muted-foreground',
    borderClass: 'border-border',
  },
  no_show: {
    label: 'No Show',
    color: 'rose',
    bgClass: 'bg-rose-500/10',
    textClass: 'text-rose-400',
    borderClass: 'border-rose-500/30',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'muted',
    bgClass: 'bg-muted/50',
    textClass: 'text-muted-foreground',
    borderClass: 'border-border',
  },
};

export function getVisitStatusConfig(status) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.checked_in;
}
