import { useLocation, Link } from 'react-router-dom';
import { BreadcrumbSetter } from '@/components/layout/PageBreadcrumb';
import { AdmissionForm } from '@/components/wards/AdmissionForm';

export default function AdmissionCreatePage() {
  const location = useLocation();
  const wardId = location.state?.wardId;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Breadcrumb navigation */}
      <BreadcrumbSetter 
        breadcrumbs={[
          { label: 'Wards', path: '/wards' },
          { label: 'New Admission', path: '/admissions/new' }
        ]}
      />
        

      <h1 className="text-3xl font-bold">New Patient Admission</h1>
      
      <AdmissionForm wardId={wardId} />
    </div>
  );
}