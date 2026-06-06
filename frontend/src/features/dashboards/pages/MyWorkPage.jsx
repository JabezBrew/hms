import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import BookOpen from 'lucide-react/dist/esm/icons/book-open.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Siren from 'lucide-react/dist/esm/icons/siren.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useDashboardModuleGates } from '@/features/dashboards/hooks';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

const WORK_AREAS = [
  {
    key: 'outpatient',
    title: 'Outpatient',
    description: 'Clinic sessions and waiting rooms',
    href: '/care-areas/outpatient',
    icon: Stethoscope,
    features: ['outpatient_encounters'],
  },
  {
    key: 'inpatient',
    title: 'Inpatient',
    description: 'Ward census and inpatient work',
    href: '/care-areas/inpatient',
    icon: Bed,
    features: ['ward_task_board', 'patient_chronicle', 'wards', 'inpatient_admissions', 'nursing_workflows'],
  },
  {
    key: 'emergency',
    title: 'Emergency',
    description: 'Triage and emergency flow',
    href: '/care-areas/emergency',
    icon: Siren,
    features: ['emergency_encounters'],
  },
  {
    key: 'my-patients',
    title: 'My context',
    description: 'Patients related to your current clinical context',
    href: '/patients/my-patients',
    icon: ClipboardList,
    features: ['patient_chronicle'],
  },
  {
    key: 'directory',
    title: 'Patient Directory',
    description: 'Search all patient records',
    href: '/patients',
    icon: BookOpen,
    features: ['patient_chronicle'],
  },
];

export default function MyWorkPage() {
  const moduleGate = useDashboardModuleGates();
  const pageMeta = usePageMeta({
    title: 'My Work | Hospital Management System',
    breadcrumbs: [{ label: 'My Work', path: '/my-work' }],
  });
  const visibleAreas = WORK_AREAS.filter((area) => moduleGate.canUse(area.features));

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="My Work"
        description="Start from the care context you are working in"
        size="md"
      />
      <main className="p-4 sm:p-6 space-y-6">
        {moduleGate.isResolving ? (
          <PageState variant="loading" fullHeight={false} className="rounded-lg border border-border" />
        ) : null}

        {!moduleGate.isResolving && !moduleGate.hasFeatureMap ? (
          <PageState
            variant="error"
            title="Work areas unavailable"
            description={moduleGate.error?.message || 'Module entitlements could not be loaded.'}
            action={() => moduleGate.refetch()}
            fullHeight={false}
            className="rounded-lg border border-border"
          />
        ) : null}

        {!moduleGate.isResolving && moduleGate.hasFeatureMap && visibleAreas.length === 0 ? (
          <PageState
            variant="empty"
            title="No work areas enabled"
            description="No clinical work areas are enabled for this deployment."
            fullHeight={false}
            className="rounded-lg border border-border"
          />
        ) : null}

        {!moduleGate.isResolving && moduleGate.hasFeatureMap && visibleAreas.length > 0 ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Care contexts">
            {visibleAreas.map((area) => (
              <WorkAreaCard key={area.key} area={area} />
            ))}
          </section>
        ) : null}
      </main>
    </PageShell>
  );
}

function WorkAreaCard({ area }) {
  const Icon = area.icon;

  return (
    <Card className="rounded-lg">
      <CardHeader className="gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md border border-border bg-muted p-2 text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <CardTitle className="font-heading text-base">{area.title}</CardTitle>
            <CardDescription>{area.description}</CardDescription>
          </div>
        </div>
        <CardAction>
          <Button asChild size="sm" variant="outline" className="font-mono text-xs">
            <Link to={area.href}>
              Open
              <ArrowRight className="ml-2 size-4" aria-hidden="true" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}
