import { cn } from '@/lib/utils';

export function InfoItem({ label, value, icon: Icon, className }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-center gap-1.5 mb-1">
        {Icon ? <Icon className="size-3.5 text-muted-foreground" /> : null}
        <p className="font-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="text-sm sm:text-base text-foreground truncate">
        {value || <span className="text-muted-foreground">-</span>}
      </p>
    </div>
  );
}
