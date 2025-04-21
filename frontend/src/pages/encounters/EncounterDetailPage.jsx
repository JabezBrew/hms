import { Helmet } from 'react-helmet-async';
import { EncounterDetail } from '@/components/encounters/EncounterDetail';
import { useBreadcrumb } from '@/components/layout/PageBreadcrumb';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchEncounter } from '@/lib/api';

export default function EncounterDetailPage() {
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
          }
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
        { label: 'Encounter Details', path: `/encounters/${id}` }
      ]);
    }
  }, [loading, id, updateBreadcrumbs]);

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
      <EncounterDetail encounter={encounter} loading={loading} />
    </>
  );
}