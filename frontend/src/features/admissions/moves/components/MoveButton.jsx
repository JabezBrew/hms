import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
export function MoveButton({ className, ...props }) { return <Button {...props} className={cn('h-auto min-h-9 max-w-full whitespace-normal', className)} />; }
