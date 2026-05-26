const STATUS_CONFIG = {
  draft: {
    label: 'Draft',
    variant: 'secondary',
    bgColor: 'bg-muted',
    textColor: 'text-muted-foreground',
  },
  pending_inspection: {
    label: 'Pending Inspection',
    variant: 'outline',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-500',
    borderColor: 'border-amber-500/30',
  },
  inspecting: {
    label: 'Inspecting',
    variant: 'default',
    bgColor: 'bg-sky-500/10',
    textColor: 'text-sky-500',
    borderColor: 'border-sky-500/30',
  },
  accepted: {
    label: 'Accepted',
    variant: 'default',
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-500',
    borderColor: 'border-emerald-500/30',
  },
  partially_accepted: {
    label: 'Partially Accepted',
    variant: 'default',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-500',
    borderColor: 'border-amber-500/30',
  },
  rejected: {
    label: 'Rejected',
    variant: 'destructive',
    bgColor: 'bg-rose-500/10',
    textColor: 'text-rose-500',
    borderColor: 'border-rose-500/30',
  },
};

export function getGRNStatusConfig(status) {
  return STATUS_CONFIG[status?.toLowerCase()] || STATUS_CONFIG.draft;
}
