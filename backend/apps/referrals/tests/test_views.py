"""
Tests for referrals app API views.

Tests cover:
- ReferralViewSet (CRUD, status transitions)
"""
import pytest
from rest_framework import status
from django.utils import timezone

from apps.referrals.models import Referral
from .factories import ReferralFactory
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory


# Base URL prefix for referrals app (router registered at root)
BASE_URL = '/api/referrals'


def get_url(path=''):
    """Helper to construct URLs for referrals endpoints."""
    if path:
        return f'{BASE_URL}/{path}'
    return f'{BASE_URL}/'


@pytest.mark.tier1
class TestReferralViewSet:
    """Tests for ReferralViewSet API endpoints."""

    def test_list_referrals(self, admin_client, db):
        """Test listing all referrals."""
        ReferralFactory.create_batch(3)
        response = admin_client.get(f'{BASE_URL}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 3

    def test_list_referrals_filter_by_status(self, admin_client, db):
        """Test filtering referrals by status."""
        ReferralFactory(status='pending')
        ReferralFactory(status='pending')
        ReferralFactory(status='completed')

        response = admin_client.get(f'{BASE_URL}/', {'status': 'pending'})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_list_referrals_filter_by_urgency(self, admin_client, db):
        """Test filtering referrals by urgency."""
        ReferralFactory(urgency='urgent')
        ReferralFactory(urgency='routine')
        ReferralFactory(urgency='urgent')

        response = admin_client.get(f'{BASE_URL}/', {'urgency': 'urgent'})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_list_referrals_filter_by_department(self, admin_client, db):
        """Test filtering referrals by department."""
        ReferralFactory(referred_to_department='Cardiology')
        ReferralFactory(referred_to_department='Cardiology')
        ReferralFactory(referred_to_department='Neurology')

        response = admin_client.get(f'{BASE_URL}/', {'department': 'Cardiology'})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_create_referral(self, api_client, db):
        """Test creating a new referral."""
        from rest_framework_simplejwt.tokens import AccessToken
        # Create a practitioner with full profile chain
        practitioner = PractitionerProfileFactory()
        user = practitioner.staff.user
        token = AccessToken.for_user(user)
        token['facility_code'] = user.primary_facility.code
        api_client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {token}',
            HTTP_X_FACILITY_CODE=user.primary_facility.code
        )

        patient = PatientProfileFactory()
        from apps.encounters.tests.factories import EncounterFactory
        EncounterFactory(
            patient=patient,
            practitioner=practitioner,
            facility=patient.facility,
            status='in-progress'
        )
        data = {
            'patient': str(patient.id),
            'referred_to_department': 'Cardiology',
            'referred_to_specialty': 'Cardiology',
            'urgency': 'routine',
            'reason': 'Chest pain evaluation needed'
        }
        response = api_client.post(f'{BASE_URL}/', data, format='json')
        assert response.status_code == status.HTTP_201_CREATED
        assert Referral.objects.filter(patient=patient).exists()

    def test_retrieve_referral(self, admin_client, db):
        """Test retrieving a single referral."""
        referral = ReferralFactory(reason='Test reason')
        response = admin_client.get(f'{BASE_URL}/{referral.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['reason'] == 'Test reason'

    def test_update_referral(self, admin_client, db):
        """Test updating a referral."""
        referral = ReferralFactory(status='draft', reason='Original reason')
        data = {'reason': 'Updated reason'}
        response = admin_client.patch(
            f'{BASE_URL}/{referral.id}/',
            data,
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        referral.refresh_from_db()
        assert referral.reason == 'Updated reason'


@pytest.mark.tier2
class TestReferralInbox:
    """Tests for referral inbox endpoints."""

    def test_inbox_count_filters_results(self, api_client, db):
        """Test inbox-count returns only matching referrals."""
        from rest_framework_simplejwt.tokens import AccessToken

        practitioner = PractitionerProfileFactory()
        user = practitioner.staff.user
        facility = user.primary_facility
        token = AccessToken.for_user(user)
        token['facility_code'] = facility.code

        api_client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {token}',
            HTTP_X_FACILITY_CODE=facility.code
        )

        patient = PatientProfileFactory(facility=facility)
        ReferralFactory(status='pending', patient=patient, referred_to_provider=practitioner)
        ReferralFactory(status='accepted', patient=patient, referred_to_provider=practitioner)
        ReferralFactory(status='pending', patient=patient, referred_to_provider=None)
        ReferralFactory(status='completed', patient=patient, referred_to_provider=practitioner)

        other_practitioner = PractitionerProfileFactory(staff__primary_facility=facility)
        ReferralFactory(status='pending', patient=patient, referred_to_provider=other_practitioner)

        response = api_client.get(f'{BASE_URL}/inbox-count/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 3


@pytest.mark.tier1
class TestReferralWorkflowActions:
    """Tests for referral workflow actions."""

    def test_submit_referral(self, api_client, db):
        """Test submitting a draft referral."""
        from rest_framework_simplejwt.tokens import AccessToken
        # Create a practitioner with full profile chain
        practitioner = PractitionerProfileFactory()
        user = practitioner.staff.user
        token = AccessToken.for_user(user)
        api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        referral = ReferralFactory(status='draft')
        response = api_client.post(
            f'{BASE_URL}/{referral.id}/submit/',
            {},
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        referral.refresh_from_db()
        assert referral.status == 'pending'
        assert referral.submitted_at is not None

    def test_submit_non_draft_referral_fails(self, api_client, db):
        """Test that submitting a non-draft referral fails."""
        from rest_framework_simplejwt.tokens import AccessToken
        practitioner = PractitionerProfileFactory()
        user = practitioner.staff.user
        token = AccessToken.for_user(user)
        api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        referral = ReferralFactory(status='pending')
        response = api_client.post(
            f'{BASE_URL}/{referral.id}/submit/',
            {},
            format='json'
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_accept_referral(self, api_client, db):
        """Test accepting a pending referral."""
        from rest_framework_simplejwt.tokens import AccessToken
        # Create a practitioner (specialist) with full profile chain
        practitioner = PractitionerProfileFactory()
        user = practitioner.staff.user
        token = AccessToken.for_user(user)
        api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        referral = ReferralFactory(status='pending')
        response = api_client.post(
            f'{BASE_URL}/{referral.id}/accept/',
            {'acceptance_notes': 'Will see patient next week'},
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        referral.refresh_from_db()
        assert referral.status == 'accepted'
        assert referral.accepted_at is not None
        assert referral.referred_to_provider == practitioner

    def test_accept_non_pending_referral_fails(self, api_client, db):
        """Test that accepting a non-pending referral fails."""
        from rest_framework_simplejwt.tokens import AccessToken
        practitioner = PractitionerProfileFactory()
        user = practitioner.staff.user
        token = AccessToken.for_user(user)
        api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        referral = ReferralFactory(status='draft')
        response = api_client.post(
            f'{BASE_URL}/{referral.id}/accept/',
            {},
            format='json'
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_decline_referral(self, api_client, db):
        """Test declining a pending referral."""
        from rest_framework_simplejwt.tokens import AccessToken
        practitioner = PractitionerProfileFactory()
        user = practitioner.staff.user
        token = AccessToken.for_user(user)
        api_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

        referral = ReferralFactory(status='pending')
        response = api_client.post(
            f'{BASE_URL}/{referral.id}/decline/',
            {'decline_reason': 'Patient already seen'},
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        referral.refresh_from_db()
        assert referral.status == 'declined'
        assert referral.declined_at is not None
        assert referral.decline_reason == 'Patient already seen'


@pytest.mark.tier2
class TestReferralFiltering:
    """Tests for referral filtering capabilities."""

    def test_filter_pending_only(self, admin_client, db):
        """Test pending_only filter."""
        ReferralFactory(status='pending')
        ReferralFactory(status='accepted')
        ReferralFactory(status='scheduled')
        ReferralFactory(status='completed')
        ReferralFactory(status='draft')

        response = admin_client.get(f'{BASE_URL}/', {'pending_only': 'true'})
        assert response.status_code == status.HTTP_200_OK
        # pending, accepted, scheduled should match
        assert response.data['count'] == 3

    def test_filter_urgent_only(self, admin_client, db):
        """Test urgent_only filter."""
        ReferralFactory(urgency='urgent')
        ReferralFactory(urgency='emergency')
        ReferralFactory(urgency='routine')
        ReferralFactory(urgency='routine')

        response = admin_client.get(f'{BASE_URL}/', {'urgent_only': 'true'})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_filter_by_patient(self, admin_client, db):
        """Test filtering by patient."""
        patient = PatientProfileFactory()
        ReferralFactory(patient=patient)
        ReferralFactory(patient=patient)
        ReferralFactory()  # Different patient

        response = admin_client.get(f'{BASE_URL}/', {'patient': str(patient.id)})
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2

    def test_filter_by_referring_provider(self, admin_client, db):
        """Test filtering by referring provider."""
        provider = PractitionerProfileFactory()
        ReferralFactory(referring_provider=provider)
        ReferralFactory(referring_provider=provider)
        ReferralFactory()  # Different provider

        response = admin_client.get(
            f'{BASE_URL}/',
            {'referring_provider': str(provider.id)}
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['count'] == 2


@pytest.mark.tier1
class TestReferralAuthentication:
    """Tests for authentication requirements."""

    def test_requires_authentication(self, api_client, db):
        """Test that endpoints require authentication."""
        response = api_client.get(f'{BASE_URL}/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
