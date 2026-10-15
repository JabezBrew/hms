import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function PreviewCount({ title, value, description }) {
  const known = typeof value === 'number' && Number.isFinite(value);
  return (
    <Card>
      <CardHeader><CardDescription>{title}</CardDescription></CardHeader>
      <CardContent>
        <p className="font-display text-3xl">{known ? value : '—'}</p>
        <p className="mt-2 text-sm text-muted-foreground">{known ? description : 'Unavailable'}</p>
      </CardContent>
    </Card>
  );
}

export function DashboardPreview({ title, description, section, isLoading, count, emptyMessage, href, linkLabel, children }) {
  const available = section?.status === 'available';
  return (
    <Card>
      <CardHeader><CardTitle className="font-heading text-lg">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-28" aria-label={`Loading ${title}`} /> : !available ? (
          <p className="text-sm text-muted-foreground">This preview is unavailable. Open the workflow to continue or refresh to try again.</p>
        ) : count === 0 ? <p className="text-sm text-muted-foreground">{emptyMessage}</p> : children}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        {available && <p className="text-sm text-muted-foreground">Showing {count} records{section.has_next ? ' · More work available' : ''}</p>}
        {href && <Button asChild variant="outline" size="sm"><Link to={href}>{linkLabel}</Link></Button>}
      </CardFooter>
    </Card>
  );
}
