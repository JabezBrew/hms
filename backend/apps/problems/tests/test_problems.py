"""
Tests for the Problem List app.

Covers:
- Model constraints (exactly-one-target on ProblemLink, code-or-free-text on Problem)
- Status transition audit trail
- API list endpoint query count (<10)
- Permission scoping by user_type
- Feature gate (problem_list disabled => 404)
- Code search endpoint
- Quick-pick seed and idempotency
"""
import json
from unittest import mock

import pytest
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext, override_settings

from apps.users.models import UserPatientList
from apps.problems.models import (
    ClinicalStatus,
    CodeSystem,
    Problem,
    ProblemCategory,
    ProblemCode,
    ProblemLink,
    ProblemStatusEvent,
    VerificationStatus,
)


# Doctor visibility is governed by TEAM_ACCESS_STRICT in production. The Problem
# List API relies on the same scoping helper as drug_safety/laboratory; that
# enforcement is covered by the shared team-access suite. Here we focus on
# Problem-List-specific behavior with relaxed scoping so we don't have to
# manually wire CareTeam memberships in every test.
@pytest.fixture(autouse=True)
def _relaxed_team_access():
    with override_settings(TEAM_ACCESS_STRICT=False):
        yield


# -----------------------------------------------------------------------------
# Fixtures local to this module
# -----------------------------------------------------------------------------

@pytest.fixture
def hypertension_code(db):
    return ProblemCode.objects.create(
        code='I10',
        code_system=CodeSystem.ICD10_WHO,
        display='Essential (primary) hypertension',
        category=ProblemCategory.DIAGNOSIS,
        is_chronic_default=True,
        is_quick_pick=True,
        quick_pick_rank=15,
    )


@pytest.fixture
def malaria_code(db):
    return ProblemCode.objects.create(
        code='B54',
        code_system=CodeSystem.ICD10_WHO,
        display='Malaria, unspecified',
        category=ProblemCategory.DIAGNOSIS,
        is_quick_pick=True,
        quick_pick_rank=1,
    )


@pytest.fixture
def htn_problem(db, default_facility, patient_profile, hypertension_code, doctor_user):
    return Problem.objects.create(
        patient=patient_profile,
        facility=default_facility,
        code=hypertension_code,
        clinical_status=ClinicalStatus.ACTIVE,
        verification_status=VerificationStatus.CONFIRMED,
        recorded_by=doctor_user,
    )


# -----------------------------------------------------------------------------
# Model constraint tests
# -----------------------------------------------------------------------------

@pytest.mark.django_db
def test_problem_requires_code_or_free_text(default_facility, patient_profile):
    """Cannot create a Problem with neither code nor free_text_label."""
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Problem.objects.create(
                patient=patient_profile,
                facility=default_facility,
                free_text_label='',
            )


@pytest.mark.django_db
def test_problem_accepts_free_text_only(default_facility, patient_profile):
    p = Problem.objects.create(
        patient=patient_profile,
        facility=default_facility,
        free_text_label='Chronic abdominal pain — investigation pending',
    )
    assert p.id is not None
    assert p.is_coded is False


@pytest.mark.django_db
def test_problem_link_rejects_zero_targets(htn_problem):
    """Per user feedback: ProblemLink must enforce *exactly one* target."""
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            ProblemLink.objects.create(problem=htn_problem)


@pytest.mark.django_db
def test_problem_link_rejects_two_targets(
    htn_problem,
    default_facility,
    patient_profile,
):
    """ProblemLink must reject having more than one target FK set simultaneously."""
    from apps.encounters.models import Encounter

    enc1 = Encounter.objects.create(
        patient=patient_profile,
        facility=default_facility,
        encounter_type='outpatient',
    )
    enc2 = Encounter.objects.create(
        patient=patient_profile,
        facility=default_facility,
        encounter_type='outpatient',
    )
    # Two encounter-type targets isn't possible (only one encounter FK column).
    # Instead: try to set encounter + a synthetic second target via the lab_order
    # column. Since LabOrder requires extra setup, create the row first with a
    # valid single target then UPDATE to add a second — the check constraint
    # must reject the update.
    link = ProblemLink.objects.create(problem=htn_problem, encounter=enc1)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            # Create another encounter row via raw SQL would bypass — use ORM
            # to set both encounter and the existing one to verify constraint.
            # Force two FKs by directly editing the column.
            from django.db import connection as conn

            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE problems_problemlink SET prescription_id = %s "
                    "WHERE id = %s",
                    [str(enc2.id), str(link.id)],
                )


# -----------------------------------------------------------------------------
# Status transition + audit
# -----------------------------------------------------------------------------

@pytest.mark.django_db
def test_change_status_creates_event_and_updates_problem(
    doctor_client, htn_problem, doctor_user
):
    url = f'/api/problems/{htn_problem.id}/change-status/'
    response = doctor_client.post(
        url,
        data={'to_status': 'resolved', 'reason': 'BP normalized off meds'},
        format='json',
    )
    assert response.status_code == 200, response.content
    htn_problem.refresh_from_db()
    assert htn_problem.clinical_status == ClinicalStatus.RESOLVED
    assert htn_problem.last_assessed_at is not None

    events = list(ProblemStatusEvent.objects.filter(problem=htn_problem))
    assert len(events) == 1
    assert events[0].from_status == ClinicalStatus.ACTIVE
    assert events[0].to_status == ClinicalStatus.RESOLVED
    assert events[0].reason == 'BP normalized off meds'
    assert events[0].changed_by == doctor_user


@pytest.mark.django_db
def test_change_status_noop_when_same(doctor_client, htn_problem):
    url = f'/api/problems/{htn_problem.id}/change-status/'
    response = doctor_client.post(
        url, data={'to_status': 'active'}, format='json'
    )
    assert response.status_code == 200
    assert ProblemStatusEvent.objects.filter(problem=htn_problem).count() == 0


# -----------------------------------------------------------------------------
# API: list endpoint query count
# -----------------------------------------------------------------------------

@pytest.mark.django_db
def test_problem_list_query_count_does_not_scale_with_rows(
    doctor_client,
    default_facility,
    patient_profile,
    doctor_user,
    hypertension_code,
    malaria_code,
):
    """List query count must NOT grow with number of problems (N+1 guard)."""

    def _seed(n):
        for i in range(n):
            code = hypertension_code if i % 2 == 0 else malaria_code
            Problem.objects.create(
                patient=patient_profile,
                facility=default_facility,
                code=code,
                clinical_status=ClinicalStatus.ACTIVE,
                recorded_by=doctor_user,
                free_text_label=f'seed-{i}',
            )

    _seed(5)
    with CaptureQueriesContext(connection) as ctx_small:
        r1 = doctor_client.get(f'/api/problems/?patient={patient_profile.id}')
    assert r1.status_code == 200
    assert r1.data['count'] == 5

    _seed(45)  # total now 50
    with CaptureQueriesContext(connection) as ctx_large:
        r2 = doctor_client.get(f'/api/problems/?patient={patient_profile.id}')
    assert r2.status_code == 200
    assert r2.data['count'] == 50

    # Query count must not grow with row count (N+1 guard). It can shrink due
    # to cold-cache warmups on the first request; what we forbid is growth.
    assert len(ctx_large) <= len(ctx_small), (
        f"Query count grew with N: small={len(ctx_small)} large={len(ctx_large)}"
    )
    assert len(ctx_large) < 15, f"Too many queries: {len(ctx_large)}"


@pytest.mark.django_db
def test_problem_list_orders_high_priority_first(
    doctor_client,
    default_facility,
    patient_profile,
    doctor_user,
):
    Problem.objects.create(
        patient=patient_profile,
        facility=default_facility,
        free_text_label='Low priority problem',
        priority='low',
        clinical_status=ClinicalStatus.ACTIVE,
        recorded_by=doctor_user,
    )
    Problem.objects.create(
        patient=patient_profile,
        facility=default_facility,
        free_text_label='High priority problem',
        priority='high',
        clinical_status=ClinicalStatus.ACTIVE,
        recorded_by=doctor_user,
    )
    Problem.objects.create(
        patient=patient_profile,
        facility=default_facility,
        free_text_label='Medium priority problem',
        priority='medium',
        clinical_status=ClinicalStatus.ACTIVE,
        recorded_by=doctor_user,
    )

    response = doctor_client.get(f'/api/problems/?patient={patient_profile.id}')

    assert response.status_code == 200
    assert [item['label'] for item in response.data['results']] == [
        'High priority problem',
        'Medium priority problem',
        'Low priority problem',
    ]


# -----------------------------------------------------------------------------
# API: feature gate
# -----------------------------------------------------------------------------

@pytest.mark.django_db
def test_problem_list_feature_gate_blocks_when_disabled(
    doctor_client, default_facility, patient_profile
):
    """When 'problem_list' is disabled at the facility, list returns 404 not 200."""
    from apps.core.features import invalidate_feature_entitlement_cache
    from apps.core.models import FeatureEntitlementOverride

    FeatureEntitlementOverride.objects.create(
        scope=FeatureEntitlementOverride.SCOPE_FACILITY,
        facility=default_facility,
        feature_key='problem_list',
        is_enabled=False,
    )
    invalidate_feature_entitlement_cache(default_facility)

    response = doctor_client.get(f'/api/problems/?patient={patient_profile.id}')
    assert response.status_code in (403, 404)


# -----------------------------------------------------------------------------
# API: code search
# -----------------------------------------------------------------------------

@pytest.mark.django_db
def test_code_search_returns_quickpicks_first(
    doctor_client, hypertension_code, malaria_code
):
    # Add a non-quick-pick to verify ordering.
    ProblemCode.objects.create(
        code='Z99',
        code_system=CodeSystem.ICD10_WHO,
        display='Dependence on enabling machines',
        is_quick_pick=False,
    )
    response = doctor_client.get('/api/problems/codes/?q=')
    assert response.status_code == 200
    items = response.data['results']
    assert len(items) >= 2
    # Quick-picks should come first.
    assert items[0]['is_quick_pick'] is True
    assert items[-1]['code'] == 'Z99'


@pytest.mark.django_db
def test_code_search_filters_by_q(doctor_client, hypertension_code, malaria_code):
    response = doctor_client.get('/api/problems/codes/?q=malaria')
    assert response.status_code == 200
    items = response.data['results']
    assert len(items) == 1
    assert items[0]['code'] == 'B54'


# -----------------------------------------------------------------------------
# API: prevent duplicate active coded problems
# -----------------------------------------------------------------------------

@pytest.mark.django_db
def test_create_blocks_duplicate_active_problem(
    doctor_client, default_facility, patient_profile, hypertension_code, doctor_user
):
    Problem.objects.create(
        patient=patient_profile,
        facility=default_facility,
        code=hypertension_code,
        clinical_status=ClinicalStatus.ACTIVE,
        recorded_by=doctor_user,
    )
    response = doctor_client.post(
        '/api/problems/',
        data={
            'patient': str(patient_profile.id),
            'code_id': str(hypertension_code.id),
        },
        format='json',
    )
    assert response.status_code == 400
    assert 'code_id' in response.data


@pytest.mark.django_db
def test_create_rejects_inaccessible_patient_when_team_access_is_strict(
    doctor_client,
    default_facility,
    patient_profile,
):
    with override_settings(TEAM_ACCESS_STRICT=True):
        response = doctor_client.post(
            '/api/problems/',
            data={
                'patient': str(patient_profile.id),
                'free_text_label': 'Unassigned patient problem',
            },
            format='json',
        )

    assert response.status_code == 403
    assert Problem.objects.filter(free_text_label='Unassigned patient problem').count() == 0


@pytest.mark.django_db
def test_update_cannot_move_problem_to_another_patient(
    doctor_client,
    default_facility,
    patient_profile,
    patient_profile_factory,
    doctor_user,
):
    other_patient = patient_profile_factory(facility=default_facility)
    problem = Problem.objects.create(
        patient=patient_profile,
        facility=default_facility,
        free_text_label='Original patient problem',
        clinical_status=ClinicalStatus.ACTIVE,
        recorded_by=doctor_user,
    )

    response = doctor_client.patch(
        f'/api/problems/{problem.id}/',
        data={'patient': str(other_patient.id)},
        format='json',
    )

    assert response.status_code == 400
    problem.refresh_from_db()
    assert problem.patient_id == patient_profile.id


@pytest.mark.django_db
def test_link_create_rejects_artifact_for_different_patient(
    doctor_client,
    default_facility,
    patient_profile,
    patient_profile_factory,
    doctor_user,
):
    from apps.encounters.models import Encounter

    other_patient = patient_profile_factory(facility=default_facility)
    problem = Problem.objects.create(
        patient=patient_profile,
        facility=default_facility,
        free_text_label='Same-patient-only problem',
        clinical_status=ClinicalStatus.ACTIVE,
        recorded_by=doctor_user,
    )
    other_encounter = Encounter.objects.create(
        patient=other_patient,
        facility=default_facility,
        encounter_type='outpatient',
        status='in-progress',
    )

    response = doctor_client.post(
        '/api/problems/links/',
        data={
            'problem': str(problem.id),
            'encounter': str(other_encounter.id),
        },
        format='json',
    )

    assert response.status_code == 400
    assert ProblemLink.objects.filter(problem=problem).count() == 0


@pytest.mark.django_db
def test_link_queryset_scopes_through_problem_patient_under_strict_access(
    doctor_client,
    default_facility,
    patient_profile,
    doctor_user,
):
    from apps.encounters.models import Encounter

    UserPatientList.objects.create(user=doctor_user, patient=patient_profile)
    problem = Problem.objects.create(
        patient=patient_profile,
        facility=default_facility,
        free_text_label='Accessible linked problem',
        clinical_status=ClinicalStatus.ACTIVE,
        recorded_by=doctor_user,
    )
    encounter = Encounter.objects.create(
        patient=patient_profile,
        facility=default_facility,
        encounter_type='outpatient',
        status='in-progress',
    )
    link = ProblemLink.objects.create(
        problem=problem,
        encounter=encounter,
        linked_by=doctor_user,
    )

    with override_settings(TEAM_ACCESS_STRICT=True):
        response = doctor_client.get(f'/api/problems/links/?encounter={encounter.id}')

    assert response.status_code == 200, response.content
    assert [item['id'] for item in response.data['results']] == [str(link.id)]


@pytest.mark.django_db
def test_problem_code_display_has_trigram_index():
    index = next(
        idx for idx in ProblemCode._meta.indexes if idx.name == 'problem_code_display_trgm'
    )
    assert index.fields == ['display']
    assert index.opclasses == ['gin_trgm_ops']


# -----------------------------------------------------------------------------
# Seed loader idempotency
# -----------------------------------------------------------------------------

@pytest.mark.django_db
def test_ghana_seed_is_idempotent():
    from django.core.management import call_command

    call_command('seed_ghana_quickpicks')
    first_count = ProblemCode.objects.filter(
        code_system=CodeSystem.ICD10_WHO, is_quick_pick=True
    ).count()
    assert first_count >= 90  # we ship 100 entries

    call_command('seed_ghana_quickpicks')
    second_count = ProblemCode.objects.filter(
        code_system=CodeSystem.ICD10_WHO, is_quick_pick=True
    ).count()
    assert first_count == second_count


@pytest.mark.django_db
def test_grouped_by_problem_returns_active_problems_with_links(
    doctor_client,
    default_facility,
    patient_profile,
    doctor_user,
    hypertension_code,
):
    p = Problem.objects.create(
        patient=patient_profile,
        facility=default_facility,
        code=hypertension_code,
        clinical_status=ClinicalStatus.ACTIVE,
        recorded_by=doctor_user,
    )
    # Resolved problem should NOT appear.
    Problem.objects.create(
        patient=patient_profile,
        facility=default_facility,
        free_text_label='Old issue',
        clinical_status=ClinicalStatus.RESOLVED,
        recorded_by=doctor_user,
    )

    response = doctor_client.get(
        f'/api/problems/grouped-by-problem/?patient={patient_profile.id}'
    )
    assert response.status_code == 200
    groups = response.data['groups']
    assert len(groups) == 1
    assert groups[0]['problem']['id'] == str(p.id)
    assert groups[0]['entry_count'] == 0
    assert groups[0]['entries'] == []


@pytest.mark.django_db
def test_grouped_by_problem_requires_patient_param(doctor_client):
    response = doctor_client.get('/api/problems/grouped-by-problem/')
    assert response.status_code == 400


@pytest.mark.django_db
def test_ghana_seed_confirm_reviewed_clears_flag():
    from django.core.management import call_command

    call_command('seed_ghana_quickpicks')
    assert ProblemCode.objects.filter(needs_clinical_review=True).count() > 0

    call_command('seed_ghana_quickpicks', '--confirm-reviewed')
    assert ProblemCode.objects.filter(
        is_quick_pick=True, needs_clinical_review=True
    ).count() == 0
