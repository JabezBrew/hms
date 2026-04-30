import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from apps.core.tests.factories import FacilityFactory


@pytest.mark.django_db
def test_my_work_dashboard_routes_using_user_type(django_user_model, monkeypatch):
    facility = FacilityFactory(code='DASH', name='Dashboard Facility')
    user = django_user_model.objects.create_user(
        username='doctor',
        email='doctor@example.com',
        password='pass1234',
        user_type='doctor',
        primary_facility=facility,
    )
    user.facilities.add(facility)

    monkeypatch.setattr(
        'apps.dashboards.views.get_doctor_dashboard_data',
        lambda _user, _request: {'role': 'doctor', 'routed': True},
    )

    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get('/api/dashboards/my-work/')
    assert response.status_code == status.HTTP_200_OK
    assert response.data['role'] == 'doctor'
    assert response.data['routed'] is True


@pytest.mark.django_db
def test_my_work_dashboard_nurse_cache_miss_returns_projection(nurse_client):
    cache.clear()

    response = nurse_client.get('/api/dashboards/my-work/')

    assert response.status_code == status.HTTP_200_OK
    assert response.data['role'] == 'nurse'
    assert response.data['urgent']['count'] == 0


@pytest.mark.django_db
def test_nurse_dashboard_rejects_non_nurse_role(django_user_model):
    facility = FacilityFactory(code='NURSEAUTH', name='Nurse Auth Facility')
    user = django_user_model.objects.create_user(
        username='reception',
        email='reception@example.com',
        password='pass1234',
        user_type='receptionist',
        primary_facility=facility,
    )
    user.facilities.add(facility)

    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get('/api/dashboards/nurse/')
    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_nurse_dashboard_rejects_nurse_without_assigned_ward(django_user_model):
    facility = FacilityFactory(code='NURSEWARD', name='Nurse Ward Facility')
    user = django_user_model.objects.create_user(
        username='nurse-no-ward',
        email='nurse-no-ward@example.com',
        password='pass1234',
        user_type='nurse',
        primary_facility=facility,
    )
    user.facilities.add(facility)

    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get('/api/dashboards/nurse/')
    assert response.status_code == status.HTTP_403_FORBIDDEN
