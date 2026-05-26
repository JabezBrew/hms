import { EncounterForm } from '@/components/encounters/EncounterForm';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { encountersApi } from '@/features/encounters/api';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

export default function EncounterEditPage() {
  const { id } = useParams();
  const [encounter, setEncounter] = useState(null);
  const loadingRef = useRef(true);
  
  useEffect(() => {
    const loadEncounter = async () => {
      try {
        loadingRef.current = true;
        const data = await encountersApi.getEncounter(id);
        setEncounter(data);
      } catch (error) {
        console.error('Error loading encounter:', error);
      } finally {
        loadingRef.current = false;
      }
    };
    
    loadEncounter();
  }, [id]);

  const title = encounter
    ? `Edit Encounter for ${encounter.patient_name || 'Patient'} | HMS`
    : 'Edit Encounter | HMS'

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
          { label: 'Edit', path: `/encounters/${id}/edit` },
        ]
      : [
          { label: 'Encounters', path: '/encounters' },
          { label: 'Encounter Details', path: `/encounters/${id}` },
          { label: 'Edit', path: `/encounters/${id}/edit` },
        ],
  });

  return (
    <PageShell>
      {pageMeta}
      <div className="space-y-6 p-6">
        <PageHeader
          title="Edit Encounter"
          description="Update the details of this encounter"
          wrap={false}
          className="border-none bg-transparent p-0"
          titleClassName="text-3xl"
        />
        <EncounterForm isEditing={true} />
      </div>
    </PageShell>
  );
}
