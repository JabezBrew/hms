import { EncounterList } from '@/components/encounters/EncounterList';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

export default function EncountersPage() {
  const pageMeta = usePageMeta({
    title: 'Encounters | HMS',
    breadcrumbs: [{ label: 'Encounters', path: '/encounters' }],
  });

  return (
    <PageShell>
      {pageMeta}
      <EncounterList />
    </PageShell>
  );
}
