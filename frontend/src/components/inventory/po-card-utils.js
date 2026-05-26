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
  sent: {
    label: 'Sent to Supplier',
    variant: 'default',
    bgColor: 'bg-sky-500/10',
    textColor: 'text-sky-500',
    borderColor: 'border-sky-500/30',
  },
  acknowledged: {
    label: 'Acknowledged',
    variant: 'default',
    bgColor: 'bg-sky-500/10',
    textColor: 'text-sky-500',
    borderColor: 'border-sky-500/30',
  },
  receiving: {
    label: 'Receiving',
    variant: 'default',
    bgColor: 'bg-violet-500/10',
    textColor: 'text-violet-500',
    borderColor: 'border-violet-500/30',
  },
  partially_received: {
    label: 'Partially Received',
    variant: 'default',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-500',
    borderColor: 'border-amber-500/30',
  },
  received: {
    label: 'Received',
    variant: 'default',
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-500',
    borderColor: 'border-emerald-500/30',
  },
  closed: {
    label: 'Closed',
    variant: 'secondary',
    bgColor: 'bg-muted',
    textColor: 'text-muted-foreground',
  },
  cancelled: {
    label: 'Cancelled',
    variant: 'destructive',
    bgColor: 'bg-rose-500/10',
    textColor: 'text-rose-500',
    borderColor: 'border-rose-500/30',
  },
};

export function getPOStatusConfig(status) {
  return STATUS_CONFIG[status?.toLowerCase()] || STATUS_CONFIG.draft;
}

export function formatPOCurrency(amount) {
  return USD_CURRENCY_FORMATTER.format(amount || 0);
}
