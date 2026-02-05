"""
Tests for referral notification endpoints.
"""
import pytest
from rest_framework_simplejwt.tokens import AccessToken

from apps.referrals.tests.factories import ReferralNotificationFactory
from apps.users.tests.factories import DoctorUserFactory
from apps.core.tests.factories import DefaultFacilityFactory


@pytest.mark.django_db
class TestReferralNotificationViews:
    def setup_method(self):
        self.facility = DefaultFacilityFactory()
        self.user = DoctorUserFactory(primary_facility=self.facility)
        token = AccessToken.for_user(self.user)
        token['facility_code'] = self.facility.code
        self.auth_header = f'Bearer {token}'

    def test_unread_count(self, api_client):
        ReferralNotificationFactory(
            recipient=self.user,
            facility=self.facility,
            is_read=False
        )
        ReferralNotificationFactory(
            recipient=self.user,
            facility=self.facility,
            is_read=True
        )

        api_client.credentials(
            HTTP_AUTHORIZATION=self.auth_header,
            HTTP_X_FACILITY_CODE=self.facility.code
        )
        response = api_client.get('/api/referrals/notifications/unread-count/')

        assert response.status_code == 200
        assert response.data['count'] == 1

    def test_mark_all_read(self, api_client):
        ReferralNotificationFactory(
            recipient=self.user,
            facility=self.facility,
            is_read=False
        )
        ReferralNotificationFactory(
            recipient=self.user,
            facility=self.facility,
            is_read=False
        )

        api_client.credentials(
            HTTP_AUTHORIZATION=self.auth_header,
            HTTP_X_FACILITY_CODE=self.facility.code
        )
        response = api_client.post('/api/referrals/notifications/mark-all-read/')

        assert response.status_code == 200
        assert response.data['updated'] == 2
