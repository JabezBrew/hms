import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import AppointmentDetail from '@/components/appointments/AppointmentDetail';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

import { useBreadcrumb } from '@/components/layout/PageBreadcrumb';

const AppointmentDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const { updateBreadcrumbs } = useBreadcrumb();

  // Set breadcrumbs
  useEffect(() => {
    updateBreadcrumbs([
      { label: 'Appointments', path: '/appointments' },
      { label: 'Appointment Details', path: `/appointments/${id}` }
    ]);
  }, [id, updateBreadcrumbs]);

  // Simulate loading effect
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  // Handle back navigation
  const handleBack = () => {
    navigate('/appointments');
  };

  return (
    <>
      <Helmet>
        <title>Appointment Details | Hospital Management System</title>
      </Helmet>
      
      {loading ? (
        <div className="space-y-4">
          <div className="flex items-center">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="ml-4 space-y-2">
              <Skeleton className="h-4 w-[250px]" />
              <Skeleton className="h-4 w-[200px]" />
            </div>
          </div>
          <Skeleton className="h-[200px] w-full rounded-md" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-[100px] w-full rounded-md" />
            <Skeleton className="h-[100px] w-full rounded-md" />
          </div>
          <div className="flex justify-between">
            <Skeleton className="h-10 w-[100px]" />
            <div className="space-x-2">
              <Skeleton className="h-10 w-[100px] inline-block" />
              <Skeleton className="h-10 w-[100px] inline-block" />
            </div>
          </div>
        </div>
      ) : (
        <AppointmentDetail appointmentId={id} onBack={handleBack} />
      )}
    </>
  );
};

export default AppointmentDetailPage;