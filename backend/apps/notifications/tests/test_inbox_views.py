import pytest
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from apps.discharge.services import submit_medical_discharge
from apps.encounters.tests.factories import EncounterFactory
from apps.nursing.tests.factories import NursingAlertFactory
from apps.notifications.models import InboxItem
from apps.notifications.tasks import ingest_nursing_alert_async, ingest_referral_notification_async
from apps.referrals.tests.factories import ReferralNotificationFactory
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory
from apps.wards.tests.factories import AdmissionFactory, WardStaffAssignmentFactory
from apps.core.tests.factories import BreakGlassEventFactory


@pytest.mark.django_db
class TestInboxViews:
    def test_doctor_sees_own_referral_notification(self, doctor_client, doctor_user, default_facility):
        if doctor_user.primary_facility_id != default_facility.id:
            doctor_user.primary_facility = default_facility
            doctor_user.save(update_fields=['primary_facility'])
        PractitionerProfileFactory(staff__user=doctor_user, staff__primary_facility=default_facility)
        referral_notification = ReferralNotificationFactory(
            recipient=doctor_user,
            facility=default_facility,
            referral__facility=default_facility,
            referral__patient__facility=default_facility,
            referral__patient__created_by=doctor_user,
        )
        BreakGlassEventFactory(user=doctor_user, patient=referral_notification.referral.patient)
        ingest_referral_notification_async(referral_notification.id)

        response = doctor_client.get('/api/notifications/inbox/')

        assert response.status_code == 200
        ids = {item['source_id'] for item in response.data['results']}
        assert str(referral_notification.id) in ids

    def test_nurse_sees_nursing_alert(self, nurse_client, nurse_user, default_facility):
        practitioner = PractitionerProfileFactory(staff__user=nurse_user)
        alert = NursingAlertFactory(patient__facility=default_facility, facility=default_facility)
        admission = AdmissionFactory(
            patient=alert.patient,
            facility=default_facility,
            bed__ward__department__facility=default_facility,
        )
        WardStaffAssignmentFactory(
            ward=admission.bed.ward,
            practitioner=practitioner,
        )
        BreakGlassEventFactory(user=nurse_user, patient=alert.patient)
        ingest_nursing_alert_async(alert.id)

        response = nurse_client.get('/api/notifications/inbox/')

        assert response.status_code == 200
        source_ids = {item['source_id'] for item in response.data['results']}
        assert str(alert.id) in source_ids

    def test_receptionist_only_sees_non_patient_items(self, receptionist_client, receptionist_user, default_facility):
        user = receptionist_user
        if user.primary_facility_id != default_facility.id:
            user.primary_facility = default_facility
            user.save(update_fields=['primary_facility'])
        ReferralNotificationFactory(
            recipient=user,
            facility=default_facility,
            referral__facility=default_facility,
            referral__patient__facility=default_facility,
        )
        NursingAlertFactory(patient__facility=default_facility, facility=default_facility)

        InboxItem.objects.create(
            facility=default_facility,
            recipient_role='receptionist',
            source_type='lab_result',
            source_id=default_facility.id,
            title='Registration workflow placeholder',
            summary='Placeholder',
            priority='routine',
            status='read',
            is_action_required=False,
            is_read=True,
            occurred_at=default_facility.updated_at,
            dedupe_key='reception_placeholder',
        )

        response = receptionist_client.get('/api/notifications/inbox/')

        assert response.status_code == 200
        assert response.data['results']
        source_types = {item['source_type'] for item in response.data['results']}
        assert source_types == {'lab_result'}

    def test_billing_role_sees_generated_discharge_inbox_item(
        self,
        api_client,
        user_factory,
        doctor_user,
        default_facility,
    ):
        doctor_user.primary_facility = default_facility
        doctor_user.save(update_fields=['primary_facility'])
        practitioner = PractitionerProfileFactory(
            staff__user=doctor_user,
            staff__primary_facility=default_facility,
            staff__user__primary_facility=default_facility,
        )
        patient = PatientProfileFactory(facility=default_facility)

        admission = AdmissionFactory(
            patient=patient,
            facility=default_facility,
            bed__ward__department__facility=default_facility,
            admitting_doctor=practitioner,
        )
        EncounterFactory(
            patient=patient,
            facility=default_facility,
            practitioner=practitioner,
            encounter_type='inpatient',
            admission=admission,
            status='in-progress',
            created_by=doctor_user,
        )
        submit_medical_discharge(
            admission=admission,
            workflow=None,
            actor=doctor_user,
            medical_ready_at=timezone.now(),
            discharge_disposition='home',
            discharge_summary='Billing clearance pending.',
            follow_up_appointments='Clinic review in one week.',
            discharge_prescriptions=[],
            notes_snapshot={},
        )

        billing_user = user_factory(user_type='billing', first_name='Bill', last_name='User')
        billing_user.primary_facility = default_facility
        billing_user.save(update_fields=['primary_facility'])
        token = AccessToken.for_user(billing_user)
        api_client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {token}',
            HTTP_X_FACILITY_CODE=default_facility.code,
        )

        response = api_client.get('/api/notifications/inbox/')

        assert response.status_code == 200
        source_types = {item['source_type'] for item in response.data['results']}
        assert InboxItem.SourceType.DISCHARGE in source_types
