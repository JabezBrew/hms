import { Helmet } from 'react-helmet-async';
import { EncounterForm } from '@/components/encounters/EncounterForm';
import { useBreadcrumb } from '@/components/layout/PageBreadcrumb';
import { useEffect } from 'react';

export default function EncounterCreatePage() {
  // Set breadcrumb
  const { updateBreadcrumbs } = useBreadcrumb();
  
  useEffect(() => {
    updateBreadcrumbs([
      { label: 'Encounters', path: '/encounters' },
      { label: 'New Encounter', path: '/encounters/new' }
    ]);
  }, [updateBreadcrumbs]);

  return (
    <>
      <Helmet>
        <title>New Encounter | HMS</title>
        <meta name="description" content="Create a new patient encounter" />
      </Helmet>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New Encounter</h1>
          <p className="text-muted-foreground">
            Create a new patient encounter record
          </p>
        </div>
        <EncounterForm />
      </div>
    </>
  );
}