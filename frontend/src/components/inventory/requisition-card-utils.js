const USD_CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

const STATUS_CONFIG = {
  draft: {
    label: 'Draft',
    variant: 'secondary',
    bgColor: 'bg-muted',
    textColor: 'text-muted-foreground',
  },
  pending: {
    label: 'Pending Approval',
    variant: 'outline',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-500',
    borderColor: 'border-amber-500/30',
  },
  approved: {
    label: 'Approved',
    variant: 'default',
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-500',
    borderColor: 'border-emerald-500/30',
  },
  rejected: {
    label: 'Rejected',
    variant: 'destructive',
    bgColor: 'bg-rose-500/10',
    textColor: 'text-rose-500',
    borderColor: 'border-rose-500/30',
  },
  converted: {
    label: 'Converted to PO',
    variant: 'default',
    bgColor: 'bg-sky-500/10',
    textColor: 'text-sky-500',
    borderColor: 'border-sky-500/30',
  },
  cancelled: {
    label: 'Cancelled',
    variant: 'secondary',
    bgColor: 'bg-muted',
    textColor: 'text-muted-foreground',
  },
};

const PRIORITY_CONFIG = {
  low: {
    label: 'Low',
    color: 'text-muted-foreground',
  },
  normal: {
    label: 'Normal',
    color: 'text-sky-500',
  },
  high: {
    label: 'High',
    color: 'text-amber-500',
  },
  urgent: {
    label: 'Urgent',
    color: 'text-rose-500',
  },
};

export function getRequisitionStatusConfig(status) {
  return STATUS_CONFIG[status?.toLowerCase()] || STATUS_CONFIG.draft;
}

export function getRequisitionPriorityConfig(priority) {
  return PRIORITY_CONFIG[priority?.toLowerCase()] || PRIORITY_CONFIG.normal;
}

export function formatRequisitionCurrency(amount) {
  return USD_CURRENCY_FORMATTER.format(amount || 0);
}
