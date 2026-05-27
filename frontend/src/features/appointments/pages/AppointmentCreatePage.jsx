/* oxlint-disable react-doctor/prefer-useReducer -- Booking state is owned by useAppointmentCreateController; a reducer would not improve the render shell. */
import { Form } from '@/components/ui/form';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

import { AppointmentCreateHeader } from './appointment-create/AppointmentCreateHeader';
import { AppointmentCreateLoadingState } from './appointment-create/AppointmentCreateLoadingState';
import { AppointmentCreateSidebar } from './appointment-create/AppointmentCreateSidebar';
import { AppointmentCreateTimePanel } from './appointment-create/AppointmentCreateTimePanel';
import { useAppointmentCreateController } from './appointment-create/useAppointmentCreateController';

const AppointmentCreatePage = () => {
  const controller = useAppointmentCreateController();
  const pageMeta = usePageMeta({
    title: 'Schedule Appointment | Hospital Management System',
    breadcrumbs: [
      { label: 'Schedule', path: '/appointments' },
      { label: 'Schedule Appointment' },
    ],
  });

  if (controller.loading) {
    return <AppointmentCreateLoadingState pageMeta={pageMeta} />;
  }

  return (
    <PageShell className="h-screen flex flex-col overflow-hidden">
      {pageMeta}

      <AppointmentCreateHeader
        isWaitlistPromotion={controller.isWaitlistPromotion}
        onBack={controller.navigateToAppointments}
        progress={controller.progress}
      />

      <div className="flex-1 overflow-hidden">
        <Form {...controller.form}>
          <form onSubmit={controller.form.handleSubmit(controller.onSubmit)} className="h-full">
            <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] h-full">
              <AppointmentCreateSidebar
                appointmentTypes={controller.appointmentTypes}
                clearSelectedTime={controller.clearSelectedTime}
                clinicState={{
                  isPoolClinic: controller.isPoolClinic,
                  selectedClinic: controller.selectedClinic,
                  watchClinicId: controller.watchClinicId,
                }}
                clinics={controller.clinics}
                form={controller.form}
                formReady={controller.formReady}
                handleClinicChange={controller.handleClinicChange}
                handlePractitionerChange={controller.handlePractitionerChange}
                onCancel={controller.navigateToAppointments}
                patientOptions={controller.patientOptions}
                practitionerOptions={controller.practitionerOptions}
                selectedSlotRequiresOverbook={controller.selectedSlotRequiresOverbook}
                setPatientSearchQuery={controller.setPatientSearchQuery}
                setPractitionerSearchQuery={controller.setPractitionerSearchQuery}
                searchState={{
                  isLoadingPatients: controller.isLoadingPatients,
                  isLoadingPractitioners: controller.isLoadingPractitioners,
                }}
                submissionState={{
                  isWaitlistPromotion: controller.isWaitlistPromotion,
                  submitting: controller.submitting,
                }}
              />

              <AppointmentCreateTimePanel
                form={controller.form}
                handleSlotSelect={controller.handleSlotSelect}
                isPoolClinic={controller.isPoolClinic}
                requiresPractitioner={controller.requiresPractitioner}
                selectedClinicName={controller.selectedClinic?.name}
                selectedPatientName={controller.selectedPatientName}
                selectedPractitionerName={controller.selectedPractitionerName}
                selectedTypeName={controller.selectedTypeName}
                watchAppointmentTypeId={controller.watchAppointmentTypeId}
                watchClinicId={controller.watchClinicId}
                watchPractitionerId={controller.watchPractitionerId}
              />
            </div>
          </form>
        </Form>
      </div>
    </PageShell>
  );
};

export default AppointmentCreatePage;
