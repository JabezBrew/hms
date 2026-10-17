import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
export function ConsultationButton({ className, ...props }) {
  return <Button className={cn('h-auto min-h-9 max-w-full whitespace-normal text-left', className)} {...props} />;
}
