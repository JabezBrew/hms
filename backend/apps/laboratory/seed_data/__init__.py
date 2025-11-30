"""
Modular lab test seed data.

Each module provides a list of lab test definitions for a specific category.
This allows facilities to customize which tests they want to seed.
"""

from .hematology import HEMATOLOGY_TESTS
from .chemistry import CHEMISTRY_TESTS
from .liver_function import LIVER_FUNCTION_TESTS
from .renal_function import RENAL_FUNCTION_TESTS
from .lipid_panel import LIPID_TESTS
from .thyroid import THYROID_TESTS
from .cardiac import CARDIAC_TESTS
from .coagulation import COAGULATION_TESTS
from .urinalysis import URINALYSIS_TESTS
from .diabetes import DIABETES_TESTS
from .electrolytes import ELECTROLYTE_TESTS
from .infectious import INFECTIOUS_DISEASE_TESTS
from .panels import STANDARD_PANELS


def get_all_tests():
    """Return all system default tests from all categories."""
    all_tests = []
    all_tests.extend(HEMATOLOGY_TESTS)
    all_tests.extend(CHEMISTRY_TESTS)
    all_tests.extend(LIVER_FUNCTION_TESTS)
    all_tests.extend(RENAL_FUNCTION_TESTS)
    all_tests.extend(LIPID_TESTS)
    all_tests.extend(THYROID_TESTS)
    all_tests.extend(CARDIAC_TESTS)
    all_tests.extend(COAGULATION_TESTS)
    all_tests.extend(URINALYSIS_TESTS)
    all_tests.extend(DIABETES_TESTS)
    all_tests.extend(ELECTROLYTE_TESTS)
    all_tests.extend(INFECTIOUS_DISEASE_TESTS)
    return all_tests


def get_tests_by_category(category):
    """Return tests for a specific category."""
    category_map = {
        'hematology': HEMATOLOGY_TESTS,
        'chemistry': CHEMISTRY_TESTS,
        'liver': LIVER_FUNCTION_TESTS,
        'renal': RENAL_FUNCTION_TESTS,
        'lipid': LIPID_TESTS,
        'thyroid': THYROID_TESTS,
        'cardiac': CARDIAC_TESTS,
        'coagulation': COAGULATION_TESTS,
        'urinalysis': URINALYSIS_TESTS,
        'diabetes': DIABETES_TESTS,
        'electrolytes': ELECTROLYTE_TESTS,
        'infectious': INFECTIOUS_DISEASE_TESTS,
    }
    return category_map.get(category, [])


def get_all_panels():
    """Return all system default panels."""
    return STANDARD_PANELS


__all__ = [
    'get_all_tests',
    'get_tests_by_category',
    'get_all_panels',
    'HEMATOLOGY_TESTS',
    'CHEMISTRY_TESTS',
    'LIVER_FUNCTION_TESTS',
    'RENAL_FUNCTION_TESTS',
    'LIPID_TESTS',
    'THYROID_TESTS',
    'CARDIAC_TESTS',
    'COAGULATION_TESTS',
    'URINALYSIS_TESTS',
    'DIABETES_TESTS',
    'ELECTROLYTE_TESTS',
    'INFECTIOUS_DISEASE_TESTS',
    'STANDARD_PANELS',
]
