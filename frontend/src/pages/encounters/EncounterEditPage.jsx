import { Helmet } from 'react-helmet-async';
import { EncounterForm } from '@/components/encounters/EncounterForm';
import { useBreadcrumb } from '@/components/layout/PageBreadcrumb';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchEncounter } from '@/lib/api';

export default function EncounterEditPage() {
  const { id } = useParams();
  const [encounter, setEncounter] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Set breadcrumb
  const { updateBreadcrumbs } = useBreadcrumb();
  
  useEffect(() => {
    const loadEncounter = async () => {
      try {
        setLoading(true);
        const data = await fetchEncounter(id);
        setEncounter(data);
        
        // Update breadcrumb with patient name if available
        updateBreadcrumbs([
          { label: 'Home', path: '/' },
          { label: 'Encounters', path: '/encounters' },
          { 
            label: data.patient_name 
              ? `Encounter for ${data.patient_name}` 
              : `Encounter ${id}`, 
            path: `/encounters/${id}` 
          },
          { label: 'Edit', path: `/encounters/${id}/edit` }
        ]);
      } catch (error) {
        console.error('Error loading encounter:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadEncounter();
  }, [id, updateBreadcrumbs]);
  
  // Set default breadcrumb while loading
  useEffect(() => {
    if (loading) {
      updateBreadcrumbs([
        { label: 'Home', path: '/' },
        { label: 'Encounters', path: '/encounters' },
        { label: 'Encounter Details', path: `/encounters/${id}` },
        { label: 'Edit', path: `/encounters/${id}/edit` }
      ]);
    }
  }, [loading, id, updateBreadcrumbs]);

  return (
    <>
      <Helmet>
        <title>
          {encounter 
            ? `Edit Encounter for ${encounter.patient_name || 'Patient'} | HMS` 
            : 'Edit Encounter | HMS'}
        </title>
        <meta name="description" content="Edit encounter details" />
      </Helmet>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edit Encounter</h1>
          <p className="text-muted-foreground">
            Update the details of this encounter
          </p>
        </div>
        <EncounterForm isEditing={true} />
      </div>
    </>
  );
}