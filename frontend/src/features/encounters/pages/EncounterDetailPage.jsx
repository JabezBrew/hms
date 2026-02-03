import { EncounterDetail } from '@/components/encounters/EncounterDetail';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useEncounter } from '@/features/encounters/hooks/useEncounterQueries';
import { toast } from 'sonner';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

export default function EncounterDetailPage() {
  const { id } = useParams();
  const { data: encounter, isLoading, isError, error } = useEncounter(id);

  const title = encounter
    ? `Encounter for ${encounter.patient_name || 'Patient'} | HMS`
    : 'Encounter Details | HMS'

  const pageMeta = usePageMeta({
    title,
    breadcrumbs: encounter
      ? [
          { label: 'Encounters', path: '/encounters' },
          {
            label: encounter.patient_name
              ? `Encounter for ${encounter.patient_name}`
              : `Encounter ${id}`,
            path: `/encounters/${id}`,
          },
        ]
      : [
          { label: 'Encounters', path: '/encounters' },
          { label: 'Encounter Details', path: `/encounters/${id}` },
        ],
  });

  // Show error toast if query fails
  useEffect(() => {
    if (isError) {
      toast.error(error?.message || 'Failed to load encounter details');
      console.error('Error loading encounter:', error);
    }
  }, [isError, error]);

  return (
    <PageShell>
      {pageMeta}
      <EncounterDetail encounter={encounter} loading={isLoading} isError={isError} />
    </PageShell>
  );
}
