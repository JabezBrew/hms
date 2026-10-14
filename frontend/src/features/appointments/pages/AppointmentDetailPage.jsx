import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { navigateToReturnTo } from '@/shared/lib/returnTo';
import AppointmentDetail from '@/features/appointments/components/AppointmentDetail';

const AppointmentDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const pageMeta = usePageMeta({
    title: 'Appointment Details | Hospital Management System',
    breadcrumbs: [
      { label: 'Appointments', path: '/appointments' },
      { label: 'Appointment Details', path: `/appointments/${id}` },
    ],
  });

  // Handle back navigation
  const handleBack = () => {
    navigateToReturnTo(navigate, location, '/appointments');
  };

  return (
    <PageShell>
      {pageMeta}
      <AppointmentDetail appointmentId={id} onBack={handleBack} />
    </PageShell>
  );
};

export default AppointmentDetailPage;
