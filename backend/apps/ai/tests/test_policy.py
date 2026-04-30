import pytest
from django.core.cache import cache
from django.test import override_settings

from apps.ai import constants
from apps.ai.services import policy


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def clear_feature_cache():
    cache.clear()


@override_settings(
    AI_ENABLED=True,
    AI_OMNI_NL_ENABLED=True,
    DEPLOYMENT_FEATURES={'ai_omni_nl': True},
)
def test_feature_flag_resolution():
    assert policy.is_feature_enabled(constants.FEATURE_OMNI_NL) is True


@override_settings(
    AI_ENABLED=True,
    AI_OMNI_NL_ENABLED=True,
    DEPLOYMENT_FEATURES={'ai_omni_nl': False},
)
def test_ai_feature_flag_respects_deployment_entitlement():
    assert policy.is_feature_enabled(constants.FEATURE_OMNI_NL) is False

    with pytest.raises(Exception) as exc:
        policy.ensure_feature_enabled(constants.FEATURE_OMNI_NL)

    assert getattr(exc.value, 'status_code', None) == 404
    assert exc.value.detail['code'] == 'feature_disabled'
    assert exc.value.detail['feature'] == 'ai_omni_nl'


def test_requires_confirmation_for_sensitive_intents():
    assert policy.requires_confirmation('order.create') is True
    assert policy.requires_confirmation('break_glass.open') is True
    assert policy.requires_confirmation('navigate.patient') is False


def test_confidence_bands_with_omni_fallback():
    assert policy.confidence_band(0.6, feature=constants.FEATURE_OMNI_NL) == 'fallback'
    assert policy.confidence_band(0.6, feature=constants.FEATURE_CHRONICLE_COPILOT) == 'needs_review'
    assert policy.confidence_band(0.8, feature=constants.FEATURE_NOTE_DRAFT) == 'advisory'
    assert policy.confidence_band(0.9, feature=constants.FEATURE_NOTE_DRAFT) == 'normal'
