import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { differenceInDays, isPast, parseISO, format } from 'date-fns';

/**
 * ExpiryBadge - Displays expiry status with color-coded badge
 * @param {Object} props
 * @param {string|Date} props.expiryDate - The expiry date
 * @param {number} [props.warningDays=30] - Days before expiry to show warning
 * @param {number} [props.criticalDays=7] - Days before expiry to show critical
 * @param {boolean} [props.showDate=false] - Whether to show the actual date
 * @param {boolean} [props.hideIfOk=false] - Hide badge if not expiring soon
 * @param {string} [props.className] - Additional CSS classes
 */
export function ExpiryBadge({
  expiryDate,
  warningDays = 30,
  criticalDays = 7,
  showDate = false,
  hideIfOk = false,
  className,
}) {
  if (!expiryDate) return null;

  const date = typeof expiryDate === 'string' ? parseISO(expiryDate) : expiryDate;
  const today = new Date();
  const daysUntilExpiry = differenceInDays(date, today);
  const isExpired = isPast(date);

  const getExpiryStatus = () => {
    if (isExpired) {
      return {
        label: 'Expired',
        variant: 'destructive',
        className: 'bg-rose-500 hover:bg-rose-600 text-white',
      };
    }
    if (daysUntilExpiry <= criticalDays) {
      return {
        label: `${daysUntilExpiry}d`,
        variant: 'destructive',
        className: 'bg-rose-500 hover:bg-rose-600 text-white',
      };
    }
    if (daysUntilExpiry <= warningDays) {
      return {
        label: `${daysUntilExpiry}d`,
        variant: 'warning',
        className: 'bg-amber-500 hover:bg-amber-600 text-white',
      };
    }
    return {
      label: showDate ? format(date, 'MMM yyyy') : 'OK',
      variant: 'success',
      className: 'bg-emerald-500 hover:bg-emerald-600 text-white',
    };
  };

  const status = getExpiryStatus();

  // Hide if OK and hideIfOk is true
  if (hideIfOk && !isExpired && daysUntilExpiry > warningDays) {
    return null;
  }

  return (
    <Badge
      className={cn(status.className, className)}
      title={`Expires: ${format(date, 'PP')}`}
    >
      {status.label}
    </Badge>
  );
}

/**
 * ExpiryDateDisplay - Shows expiry date with contextual color
 * @param {Object} props
 * @param {string|Date} props.expiryDate - The expiry date
 * @param {number} [props.warningDays=30] - Days before expiry to show warning
 * @param {string} [props.className] - Additional CSS classes
 */
export function ExpiryDateDisplay({
  expiryDate,
  warningDays = 30,
  className,
}) {
  if (!expiryDate) return <span className="text-muted-foreground">-</span>;

  const date = typeof expiryDate === 'string' ? parseISO(expiryDate) : expiryDate;
  const today = new Date();
  const daysUntilExpiry = differenceInDays(date, today);
  const isExpired = isPast(date);

  const getTextColor = () => {
    if (isExpired) return 'text-rose-600';
    if (daysUntilExpiry <= 7) return 'text-rose-500';
    if (daysUntilExpiry <= warningDays) return 'text-amber-600';
    return 'text-muted-foreground';
  };

  return (
    <span className={cn('font-mono text-sm', getTextColor(), className)}>
      {format(date, 'PP')}
    </span>
  );
}
