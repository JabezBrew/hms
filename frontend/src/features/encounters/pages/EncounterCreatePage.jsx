import { EncounterForm } from '@/components/encounters/EncounterForm';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

export default function EncounterCreatePage() {
  const pageMeta = usePageMeta({
    title: 'New Encounter | HMS',
    breadcrumbs: [
      { label: 'Encounters', path: '/encounters' },
      { label: 'New Encounter', path: '/encounters/new' },
    ],
  });

  return (
    <PageShell>
      {pageMeta}
      <div className="space-y-6 p-6">
        <PageHeader
          title="New Encounter"
          description="Create a new patient encounter record"
          wrap={false}
          className="border-none bg-transparent p-0"
          titleClassName="text-3xl"
        />
        <EncounterForm />
      </div>
    </PageShell>
  );
}
