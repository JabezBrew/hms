import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

export function CareAreaScaffold({
  title,
  description,
  breadcrumb,
  actions,
  children,
}) {
  const pageMeta = usePageMeta({
    title: `${title} | Hospital Management System`,
    breadcrumbs: [{ label: 'Care Areas', path: '/my-work' }, breadcrumb],
  });

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title={title}
        description={description}
        actions={actions}
        size="md"
      />
      <main className="p-4 sm:p-6 space-y-6">
        {children}
      </main>
    </PageShell>
  );
}

export function CareAreaGrid({ children }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {children}
    </div>
  );
}

export function CareAreaCard({
  title,
  description,
  meta,
  to,
  icon: Icon,
  actionLabel = 'Open',
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader className="gap-3">
        <div className="flex items-start gap-3">
          {Icon ? (
            <div className="mt-0.5 rounded-md border border-border bg-muted p-2 text-muted-foreground">
              <Icon className="size-4" aria-hidden="true" />
            </div>
          ) : null}
          <div className="min-w-0">
            <CardTitle className="truncate font-heading text-base">{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
            {meta ? <p className="mt-2 font-mono text-xs text-muted-foreground">{meta}</p> : null}
          </div>
        </div>
        <CardAction>
          <Button asChild variant="outline" size="sm" className="font-mono text-xs">
            <Link to={to}>
              {actionLabel}
              <ArrowRight className="ml-2 size-4" aria-hidden="true" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}

export function CareAreaEmptyState({ title, description }) {
  return (
    <Card className="rounded-lg border-dashed">
      <CardContent className="py-8">
        <div className="max-w-xl space-y-2">
          <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
