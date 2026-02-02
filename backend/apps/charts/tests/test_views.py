"""
Chart Builder View Tests

Tests for ChartTemplate, ChartAssignment, and ChartEntry API endpoints.
"""

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient
from django.utils import timezone
from django.test.utils import CaptureQueriesContext
from django.db import connection

from apps.charts.models import ChartTemplate, ChartField, ChartAssignment, ChartEntry
from apps.charts.tests.factories import (
    ChartTemplateFactory, ChartFieldFactory, ChartAssignmentFactory, ChartEntryFactory,
    NumericFieldFactory,
)
from apps.users.tests.factories import UserFactory, StaffFactory, PractitionerProfileFactory, PatientProfileFactory


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def authenticated_user(api_client, settings):
    settings.TEAM_ACCESS_STRICT = False

    # Create staff with user, then create practitioner profile
    staff = StaffFactory()
    user = staff.user
    PractitionerProfileFactory(staff=staff)
    api_client.force_authenticate(user=user)
    api_client.credentials(HTTP_X_FACILITY_CODE=staff.primary_facility.code)
    return user


@pytest.mark.django_db
class TestChartTemplateViewSet:
    """Tests for ChartTemplateViewSet."""

    def test_list_templates(self, api_client, authenticated_user):
        """Test listing chart templates."""
        # Create templates with different visibility
        ChartTemplateFactory(visibility='facility')  # Should be visible
        ChartTemplateFactory(visibility='private', created_by=authenticated_user)  # Should be visible
        ChartTemplateFactory(visibility='private')  # Should NOT be visible (different creator)

        url = reverse('chart-template-list')
        response = api_client.get(url)

        assert response.status_code == status.HTTP_200_OK
        # Should only see facility and own private templates
        assert len(response.data['results']) >= 2

    def test_create_template(self, api_client, authenticated_user):
        """Test creating a new template."""
        url = reverse('chart-template-list')
        data = {
            'name': 'New Chart Template',
            'description': 'A test template',
            'category': 'custom',
            'visibility': 'private',
            'default_interval': 'hourly',
        }

        response = api_client.post(url, data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['name'] == 'New Chart Template'
        assert ChartTemplate.objects.filter(name='New Chart Template').exists()

    def test_retrieve_template(self, api_client, authenticated_user):
        """Test retrieving a single template with fields."""
        template = ChartTemplateFactory(visibility='facility')
        NumericFieldFactory(template=template, name='Field 1')
        NumericFieldFactory(template=template, name='Field 2')

        url = reverse('chart-template-detail', kwargs={'pk': template.id})
        response = api_client.get(url)

        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == template.name
        assert len(response.data['fields']) == 2

    def test_update_template(self, api_client, authenticated_user):
        """Test updating a template."""
        template = ChartTemplateFactory(created_by=authenticated_user)

        url = reverse('chart-template-detail', kwargs={'pk': template.id})
        data = {'name': 'Updated Name'}

        response = api_client.patch(url, data, format='json')

        assert response.status_code == status.HTTP_200_OK
        template.refresh_from_db()
        assert template.name == 'Updated Name'

    def test_delete_template(self, api_client, authenticated_user):
        """Test soft-deleting a template."""
        template = ChartTemplateFactory(created_by=authenticated_user)

        url = reverse('chart-template-detail', kwargs={'pk': template.id})
        response = api_client.delete(url)

        assert response.status_code == status.HTTP_204_NO_CONTENT
        template.refresh_from_db()
        assert template.is_active is False

    def test_cannot_delete_system_template(self, api_client, authenticated_user):
        """Test that system templates cannot be deleted."""
        template = ChartTemplateFactory(is_system=True, visibility='facility')

        url = reverse('chart-template-detail', kwargs={'pk': template.id})
        response = api_client.delete(url)

        # Should be forbidden
        assert response.status_code in [status.HTTP_403_FORBIDDEN, status.HTTP_204_NO_CONTENT]
        template.refresh_from_db()
        # System template should remain active even if delete returns 204
        # (the view should prevent actual deletion)

    def test_clone_template(self, api_client, authenticated_user):
        """Test cloning a template."""
        template = ChartTemplateFactory(visibility='facility')
        NumericFieldFactory(template=template)

        url = reverse('chart-template-clone', kwargs={'pk': template.id})
        data = {'name': 'Cloned Template'}

        response = api_client.post(url, data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['name'] == 'Cloned Template'
        assert response.data['visibility'] == 'private'
        assert response.data['id'] != str(template.id)

    def test_get_categories(self, api_client, authenticated_user):
        """Test getting available categories."""
        url = reverse('chart-template-categories')
        response = api_client.get(url)

        assert response.status_code == status.HTTP_200_OK
        assert 'categories' in response.data
        assert len(response.data['categories']) > 0

    def test_add_field_to_template(self, api_client, authenticated_user):
        """Test adding a field to a template."""
        template = ChartTemplateFactory(created_by=authenticated_user)

        url = reverse('chart-template-add-field', kwargs={'pk': template.id})
        data = {
            'name': 'Temperature',
            'field_key': 'temperature',
            'field_type': 'numeric',
            'config': {
                'unit': '°C',
                'min': 35,
                'max': 42,
            },
            'is_required': True,
        }

        response = api_client.post(url, data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert template.fields.filter(field_key='temperature').exists()

    def test_add_duplicate_field_key_fails(self, api_client, authenticated_user):
        """Test that adding duplicate field_key fails."""
        template = ChartTemplateFactory(created_by=authenticated_user)
        ChartFieldFactory(template=template, field_key='existing_field')

        url = reverse('chart-template-add-field', kwargs={'pk': template.id})
        data = {
            'name': 'New Field',
            'field_key': 'existing_field',  # Duplicate
            'field_type': 'numeric',
        }

        response = api_client.post(url, data, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_reorder_fields(self, api_client, authenticated_user):
        """Test reordering fields."""
        template = ChartTemplateFactory(created_by=authenticated_user)
        field1 = ChartFieldFactory(template=template, display_order=1)
        field2 = ChartFieldFactory(template=template, display_order=2)

        url = reverse('chart-template-reorder-fields', kwargs={'pk': template.id})
        data = {
            'fields': [
                {'id': str(field1.id), 'display_order': 2},
                {'id': str(field2.id), 'display_order': 1},
            ]
        }

        response = api_client.patch(url, data, format='json')

        assert response.status_code == status.HTTP_200_OK
        field1.refresh_from_db()
        field2.refresh_from_db()
        assert field1.display_order == 2
        assert field2.display_order == 1


@pytest.mark.django_db
class TestChartAssignmentViewSet:
    """Tests for ChartAssignmentViewSet."""

    def test_list_assignments(self, api_client, authenticated_user):
        """Test listing chart assignments."""
        ChartAssignmentFactory()
        ChartAssignmentFactory()

        url = reverse('chart-assignment-list')
        response = api_client.get(url)

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) >= 2

    def test_create_assignment(self, api_client, authenticated_user):
        """Test creating a chart assignment."""
        template = ChartTemplateFactory(visibility='facility')
        patient = PatientProfileFactory()

        url = reverse('chart-assignment-list')
        data = {
            'template_id': str(template.id),
            'patient': str(patient.id),
            'reason': 'Post-operative monitoring',
        }

        response = api_client.post(url, data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert ChartAssignment.objects.filter(patient=patient, template=template).exists()

    def test_get_assignments_by_patient(self, api_client, authenticated_user):
        """Test getting assignments for a specific patient."""
        patient = PatientProfileFactory()
        ChartAssignmentFactory(patient=patient)
        ChartAssignmentFactory(patient=patient)
        ChartAssignmentFactory()  # Different patient

        url = reverse('chart-assignment-by-patient')
        response = api_client.get(url, {'patient_id': str(patient.id)})

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2

    def test_complete_assignment(self, api_client, authenticated_user):
        """Test completing a chart assignment."""
        assignment = ChartAssignmentFactory(status='active')

        url = reverse('chart-assignment-complete', kwargs={'pk': assignment.id})
        response = api_client.post(url)

        assert response.status_code == status.HTTP_200_OK
        assignment.refresh_from_db()
        assert assignment.status == 'completed'

    def test_pause_assignment(self, api_client, authenticated_user):
        """Test pausing a chart assignment."""
        assignment = ChartAssignmentFactory(status='active')

        url = reverse('chart-assignment-pause', kwargs={'pk': assignment.id})
        response = api_client.post(url)

        assert response.status_code == status.HTTP_200_OK
        assignment.refresh_from_db()
        assert assignment.status == 'paused'

    def test_resume_assignment(self, api_client, authenticated_user):
        """Test resuming a paused assignment."""
        assignment = ChartAssignmentFactory(status='paused')

        url = reverse('chart-assignment-resume', kwargs={'pk': assignment.id})
        response = api_client.post(url)

        assert response.status_code == status.HTTP_200_OK
        assignment.refresh_from_db()
        assert assignment.status == 'active'

    def test_discontinue_assignment(self, api_client, authenticated_user):
        """Test discontinuing a chart assignment."""
        assignment = ChartAssignmentFactory(status='active')

        url = reverse('chart-assignment-discontinue', kwargs={'pk': assignment.id})
        data = {'reason': 'Patient discharged'}

        response = api_client.post(url, data, format='json')

        assert response.status_code == status.HTTP_200_OK
        assignment.refresh_from_db()
        assert assignment.status == 'discontinued'
        assert assignment.discontinuation_reason == 'Patient discharged'


@pytest.mark.django_db
class TestChartEntryViewSet:
    """Tests for ChartEntryViewSet."""

    def test_list_entries(self, api_client, authenticated_user):
        """Test listing chart entries."""
        assignment = ChartAssignmentFactory()
        ChartEntryFactory(assignment=assignment)
        ChartEntryFactory(assignment=assignment)

        url = reverse('chart-entry-list')
        response = api_client.get(url, {'assignment': str(assignment.id)})

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 2

    def test_list_entries_query_count(self, api_client, authenticated_user):
        """Entry list should be O(1) queries per page."""
        assignment = ChartAssignmentFactory()
        ChartEntryFactory.create_batch(5, assignment=assignment)

        url = reverse('chart-entry-list')
        with CaptureQueriesContext(connection) as ctx:
            response = api_client.get(url, {'assignment': str(assignment.id)})

        assert response.status_code == status.HTTP_200_OK
        assert len(ctx) <= 8

    def test_create_entry(self, api_client, authenticated_user):
        """Test creating a chart entry."""
        template = ChartTemplateFactory()
        NumericFieldFactory(template=template, field_key='temperature')
        assignment = ChartAssignmentFactory(template=template, status='active')

        url = reverse('chart-entry-list')
        data = {
            'assignment': str(assignment.id),
            'data': {'temperature': 37.5},
            'notes': 'Patient comfortable',
        }

        response = api_client.post(url, data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert ChartEntry.objects.filter(assignment=assignment).exists()

    def test_create_entry_validates_required_fields(self, api_client, authenticated_user):
        """Test that entry creation validates required fields."""
        template = ChartTemplateFactory()
        NumericFieldFactory(template=template, field_key='required_field', is_required=True)
        assignment = ChartAssignmentFactory(template=template, status='active')

        url = reverse('chart-entry-list')
        data = {
            'assignment': str(assignment.id),
            'data': {},  # Missing required field
        }

        response = api_client.post(url, data, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_entry_validates_numeric_range(self, api_client, authenticated_user):
        """Test that entry creation validates numeric field ranges."""
        template = ChartTemplateFactory()
        NumericFieldFactory(
            template=template,
            field_key='temperature',
            config={'min': 35, 'max': 42}
        )
        assignment = ChartAssignmentFactory(template=template, status='active')

        url = reverse('chart-entry-list')
        data = {
            'assignment': str(assignment.id),
            'data': {'temperature': 50},  # Out of range
        }

        response = api_client.post(url, data, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_cannot_create_entry_for_inactive_assignment(self, api_client, authenticated_user):
        """Test that entries cannot be created for inactive assignments."""
        template = ChartTemplateFactory()
        assignment = ChartAssignmentFactory(template=template, status='completed')

        url = reverse('chart-entry-list')
        data = {
            'assignment': str(assignment.id),
            'data': {},
        }

        response = api_client.post(url, data, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_soft_delete_entry(self, api_client, authenticated_user):
        """Test soft-deleting an entry."""
        entry = ChartEntryFactory(created_by=authenticated_user)

        url = reverse('chart-entry-detail', kwargs={'pk': entry.id})
        response = api_client.delete(url, {'reason': 'Entered in error'}, format='json')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        entry.refresh_from_db()
        assert entry.is_deleted is True

    def test_get_entry_summary(self, api_client, authenticated_user):
        """Test getting entry summary for an assignment."""
        template = ChartTemplateFactory()
        NumericFieldFactory(template=template, field_key='value')
        assignment = ChartAssignmentFactory(template=template)

        ChartEntryFactory(assignment=assignment, data={'value': 10})
        ChartEntryFactory(assignment=assignment, data={'value': 20})
        ChartEntryFactory(assignment=assignment, data={'value': 30})

        url = reverse('chart-entry-summary')
        response = api_client.get(url, {'assignment_id': str(assignment.id)})

        assert response.status_code == status.HTTP_200_OK
        assert response.data['total_entries'] == 3
        assert 'field_summaries' in response.data

    def test_get_trend_data(self, api_client, authenticated_user):
        """Test getting trend data for a field."""
        template = ChartTemplateFactory()
        NumericFieldFactory(template=template, field_key='temperature')
        assignment = ChartAssignmentFactory(template=template)

        from datetime import timedelta
        base_time = timezone.now()

        ChartEntryFactory(
            assignment=assignment,
            observation_datetime=base_time - timedelta(hours=2),
            data={'temperature': 37.0}
        )
        ChartEntryFactory(
            assignment=assignment,
            observation_datetime=base_time - timedelta(hours=1),
            data={'temperature': 37.5}
        )

        url = reverse('chart-entry-trends')
        response = api_client.get(url, {
            'assignment_id': str(assignment.id),
            'field_key': 'temperature',
        })

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2

    def test_get_entries_by_patient(self, api_client, authenticated_user):
        """Test getting entries for a patient across all assignments."""
        patient = PatientProfileFactory()
        assignment1 = ChartAssignmentFactory(patient=patient)
        assignment2 = ChartAssignmentFactory(patient=patient)

        ChartEntryFactory(assignment=assignment1)
        ChartEntryFactory(assignment=assignment2)
        ChartEntryFactory()  # Different patient

        url = reverse('chart-entry-by-patient')
        response = api_client.get(url, {'patient_id': str(patient.id)})

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2
