import { Helmet } from 'react-helmet-async';
import { EncounterList } from '@/components/encounters/EncounterList';
import { useBreadcrumb } from '@/components/layout/PageBreadcrumb';
import { useEffect } from 'react';

export default function EncountersPage() {
  const { updateBreadcrumbs } = useBreadcrumb();

  useEffect(() => {
    updateBreadcrumbs([
      { label: 'Encounters', path: '/encounters' }
    ]);
  }, [updateBreadcrumbs]);

  return (
    <>
      <Helmet>
        <title>Encounters | HMS</title>
        <meta name="description" content="Manage patient encounters" />
      </Helmet>
      <EncounterList />
    </>
  );
}