import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
// Clinical action labels remain visible inside the dialog's narrow content area.
export function ResponseButton({ className, ...props }) {
  return <Button {...props} className={cn('h-auto min-h-9 max-w-full whitespace-normal', className)} />;
}
