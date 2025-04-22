import { Helmet } from 'react-helmet-async';
import { EncounterDetail } from '@/components/encounters/EncounterDetail';
import { useBreadcrumb } from '@/components/layout/PageBreadcrumb';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useEncounter } from '@/hooks/useEncounterQueries';
import { toast } from 'sonner';

export default function EncounterDetailPage() {
  const { id } = useParams();
  const { data: encounter, isLoading, isError, error } = useEncounter(id);

  // Set breadcrumb
  const { updateBreadcrumbs } = useBreadcrumb();

  // Update breadcrumbs when data is loaded
  useEffect(() => {
    if (encounter) {
      updateBreadcrumbs([
        { label: 'Encounters', path: '/encounters' },
        { 
          label: encounter.patient_name 
            ? `Encounter for ${encounter.patient_name}` 
            : `Encounter ${id}`, 
          path: `/encounters/${id}` 
        }
      ]);
    } else {
      updateBreadcrumbs([
        { label: 'Encounters', path: '/encounters' },
        { label: 'Encounter Details', path: `/encounters/${id}` }
      ]);
    }
  }, [encounter, id, updateBreadcrumbs]);

  // Show error toast if query fails
  useEffect(() => {
    if (isError) {
      toast.error(error?.message || 'Failed to load encounter details');
      console.error('Error loading encounter:', error);
    }
  }, [isError, error]);

  return (
    <>
      <Helmet>
        <title>
          {encounter 
            ? `Encounter for ${encounter.patient_name || 'Patient'} | HMS` 
            : 'Encounter Details | HMS'}
        </title>
        <meta name="description" content="View encounter details" />
      </Helmet>
      <EncounterDetail encounter={encounter} loading={isLoading} isError={isError} />
    </>
  );
}
