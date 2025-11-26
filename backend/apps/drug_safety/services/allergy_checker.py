"""
Allergy checking service - convenience wrapper for allergy-specific checks.
"""

from typing import List, Optional
from ..models import PatientAllergy
from .interaction_checker import InteractionChecker


class AllergyChecker:
    """Service for allergy-specific safety checks."""

    @classmethod
    def check_patient_allergies(
        cls,
        patient_id: str,
        medication_name: str
    ) -> List[dict]:
        """
        Quick check for patient allergies against a medication.

        Args:
            patient_id: Patient UUID
            medication_name: Medication name to check

        Returns:
            List of allergy matches with severity
        """
        allergies = PatientAllergy.objects.filter(
            patient_id=patient_id,
            is_active=True,
            allergy_type='drug'
        )

        matches = []
        for allergy in allergies:
            # Simple name matching
            if (allergy.allergen_name.lower() in medication_name.lower() or
                medication_name.lower() in allergy.allergen_name.lower()):
                matches.append({
                    'allergen': allergy.allergen_name,
                    'severity': allergy.severity,
                    'reaction': allergy.reaction,
                    'verified': allergy.verified_by_id is not None
                })

        return matches

    @classmethod
    def has_allergy_contraindication(
        cls,
        patient_id: str,
        medication_name: str
    ) -> bool:
        """
        Quick boolean check if medication is contraindicated by allergies.

        Args:
            patient_id: Patient UUID
            medication_name: Medication name to check

        Returns:
            True if contraindicated, False otherwise
        """
        matches = cls.check_patient_allergies(patient_id, medication_name)
        # Consider severe and life-threatening allergies as contraindications
        for match in matches:
            if match['severity'] in ['severe', 'life_threatening']:
                return True
        return False

    @classmethod
    def get_patient_active_allergies(cls, patient_id: str) -> List[PatientAllergy]:
        """
        Get all active allergies for a patient.

        Args:
            patient_id: Patient UUID

        Returns:
            QuerySet of PatientAllergy objects
        """
        return PatientAllergy.objects.filter(
            patient_id=patient_id,
            is_active=True
        ).order_by('-severity', 'allergen_name')

    @classmethod
    def add_patient_allergy(
        cls,
        patient_id: str,
        allergen_name: str,
        severity: str,
        reaction: str = '',
        allergy_type: str = 'drug',
        created_by_id: Optional[str] = None
    ) -> PatientAllergy:
        """
        Add a new allergy for a patient.

        Args:
            patient_id: Patient UUID
            allergen_name: Name of allergen
            severity: Severity level
            reaction: Description of reaction
            allergy_type: Type of allergy
            created_by_id: User who created the record

        Returns:
            Created PatientAllergy object
        """
        allergy = PatientAllergy.objects.create(
            patient_id=patient_id,
            allergen_name=allergen_name,
            severity=severity,
            reaction=reaction,
            allergy_type=allergy_type,
            created_by_id=created_by_id
        )
        return allergy
