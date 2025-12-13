"""
Drug interaction and safety checking service.
Orchestrates RxNorm and OpenFDA services to perform comprehensive drug safety checks.
"""

import logging
from typing import List, Dict, Optional
from datetime import timedelta
from django.utils import timezone
from django.db import transaction

from ..models import (
    DrugSafetyAlert, AlertSeverity, AlertType,
    DrugInteractionCache, PatientAllergy
)
from .rxnorm_service import RxNormService
from .openfda_service import OpenFDAService

logger = logging.getLogger(__name__)


class InteractionChecker:
    """Main service for checking drug interactions and safety."""

    # Severity mapping from RxNorm/OpenFDA to our system
    SEVERITY_MAP = {
        'high': AlertSeverity.CRITICAL,
        'critical': AlertSeverity.CRITICAL,
        'severe': AlertSeverity.CRITICAL,
        'moderate': AlertSeverity.HIGH,
        'minor': AlertSeverity.MODERATE,
        'low': AlertSeverity.LOW,
        'unknown': AlertSeverity.MODERATE,
    }

    @classmethod
    def check_prescription_safety(
        cls,
        patient_id: str,
        medication_name: str,
        encounter_id: Optional[str] = None
    ) -> List[DrugSafetyAlert]:
        """
        Comprehensive safety check for a new prescription.
        Checks:
        1. Drug-drug interactions with current medications
        2. Allergy cross-references
        3. Duplicate therapy
        4. Drug recalls (informational)

        Args:
            patient_id: Patient UUID
            medication_name: Name of medication being prescribed
            encounter_id: Optional encounter UUID

        Returns:
            List of DrugSafetyAlert objects (not yet saved to DB)
        """
        alerts = []

        # Get RxCUI for the new medication
        rxcui = RxNormService.get_rxcui_by_name(medication_name)

        # 1. Check drug-drug interactions
        interaction_alerts = cls._check_drug_interactions(patient_id, medication_name, rxcui)
        alerts.extend(interaction_alerts)

        # 2. Check allergy cross-references
        allergy_alerts = cls._check_allergies(patient_id, medication_name, rxcui)
        alerts.extend(allergy_alerts)

        # 3. Check duplicate therapy
        duplicate_alert = cls._check_duplicate_therapy(patient_id, medication_name)
        if duplicate_alert:
            alerts.append(duplicate_alert)

        # 4. Check drug recalls (informational only)
        recall_alert = cls._check_drug_recalls(patient_id, medication_name)
        if recall_alert:
            alerts.append(recall_alert)

        # Sort alerts by severity (critical first)
        severity_order = {
            AlertSeverity.CRITICAL: 0,
            AlertSeverity.HIGH: 1,
            AlertSeverity.MODERATE: 2,
            AlertSeverity.LOW: 3
        }
        alerts.sort(key=lambda x: severity_order.get(x.severity, 4))

        return alerts

    @classmethod
    def _check_drug_interactions(
        cls,
        patient_id: str,
        new_medication: str,
        new_medication_rxcui: Optional[str]
    ) -> List[DrugSafetyAlert]:
        """Check for drug-drug interactions with active medications."""
        from apps.clinical_notes.models import Prescription

        alerts = []

        # Get patient's active prescriptions
        active_prescriptions = Prescription.objects.filter(
            patient_id=patient_id,
            status='active'
        ).exclude(medication_name=new_medication)

        if not active_prescriptions.exists() or not new_medication_rxcui:
            return alerts

        # Collect RxCUIs of active medications
        active_rxcuis = []
        for rx in active_prescriptions:
            rxcui = RxNormService.get_rxcui_by_name(rx.medication_name)
            if rxcui:
                active_rxcuis.append((rxcui, rx.medication_name))

        # Check interactions with each active medication
        for active_rxcui, active_med_name in active_rxcuis:
            # Check cache first
            interaction = cls._get_cached_interaction(new_medication_rxcui, active_rxcui)

            if interaction is None:
                # Query RxNorm API
                interactions = RxNormService.get_drug_interactions([new_medication_rxcui, active_rxcui])

                if interactions:
                    for interaction_data in interactions:
                        # Cache the interaction
                        cls._cache_interaction(
                            new_medication_rxcui,
                            active_rxcui,
                            interaction_data
                        )

                        # Create alert
                        alert = DrugSafetyAlert(
                            patient_id=patient_id,
                            alert_type=AlertType.DRUG_INTERACTION,
                            severity=cls._map_severity(interaction_data.get('severity', 'moderate')),
                            title=f"Drug Interaction: {new_medication} + {active_med_name}",
                            description=interaction_data.get('description', 'No description available'),
                            triggering_medication=new_medication,
                            conflicting_medication=active_med_name
                        )
                        alerts.append(alert)
            elif interaction:
                # Use cached interaction
                alert = DrugSafetyAlert(
                    patient_id=patient_id,
                    alert_type=AlertType.DRUG_INTERACTION,
                    severity=cls._map_severity(interaction.severity),
                    title=f"Drug Interaction: {new_medication} + {active_med_name}",
                    description=interaction.description,
                    triggering_medication=new_medication,
                    conflicting_medication=active_med_name
                )
                alerts.append(alert)

        return alerts

    @classmethod
    def _check_allergies(
        cls,
        patient_id: str,
        medication_name: str,
        medication_rxcui: Optional[str]
    ) -> List[DrugSafetyAlert]:
        """Check for allergy cross-references."""
        alerts = []

        # Get patient's active drug allergies
        allergies = PatientAllergy.objects.filter(
            patient_id=patient_id,
            is_active=True,
            allergy_type='drug'
        )

        if not allergies.exists():
            return alerts

        # Check exact name match first
        for allergy in allergies:
            if allergy.allergen_name.lower() in medication_name.lower():
                severity = cls._map_allergy_severity_to_alert(allergy.severity)
                alert = DrugSafetyAlert(
                    patient_id=patient_id,
                    alert_type=AlertType.ALLERGY,
                    severity=severity,
                    title=f"Allergy Alert: {allergy.allergen_name}",
                    description=f"Patient has documented allergy to {allergy.allergen_name}. Reaction: {allergy.reaction or 'Not specified'}",
                    triggering_medication=medication_name,
                    conflicting_medication=allergy.allergen_name
                )
                alerts.append(alert)

        # Check drug class cross-reactivity (e.g., Penicillin class)
        if medication_rxcui:
            drug_classes = RxNormService.get_drug_class(medication_rxcui)
            for allergy in allergies:
                if allergy.allergen_code:
                    allergy_classes = RxNormService.get_drug_class(allergy.allergen_code)
                    # Check for overlapping drug classes
                    for drug_class in drug_classes:
                        for allergy_class in allergy_classes:
                            if drug_class.get('class_id') == allergy_class.get('class_id'):
                                severity = cls._map_allergy_severity_to_alert(allergy.severity)
                                alert = DrugSafetyAlert(
                                    patient_id=patient_id,
                                    alert_type=AlertType.ALLERGY,
                                    severity=severity,
                                    title=f"Cross-Allergy Alert: {drug_class.get('class_name')}",
                                    description=f"Patient has allergy to {allergy.allergen_name}, which is in the same drug class ({drug_class.get('class_name')}) as {medication_name}.",
                                    triggering_medication=medication_name,
                                    conflicting_medication=allergy.allergen_name
                                )
                                alerts.append(alert)

        return alerts

    @classmethod
    def _check_duplicate_therapy(cls, patient_id: str, medication_name: str) -> Optional[DrugSafetyAlert]:
        """Check if patient is already on the same medication."""
        from apps.clinical_notes.models import Prescription

        # Check for exact match (case-insensitive)
        duplicate = Prescription.objects.filter(
            patient_id=patient_id,
            medication_name__iexact=medication_name,
            status='active'
        ).first()

        if duplicate:
            return DrugSafetyAlert(
                patient_id=patient_id,
                alert_type=AlertType.DUPLICATE_THERAPY,
                severity=AlertSeverity.MODERATE,
                title=f"Duplicate Therapy: {medication_name}",
                description=f"Patient is already taking {medication_name}. Prescribing the same medication may lead to overdose or duplicate therapy.",
                triggering_medication=medication_name,
                conflicting_medication=medication_name
            )

        return None

    @classmethod
    def _check_drug_recalls(cls, patient_id: str, medication_name: str) -> Optional[DrugSafetyAlert]:
        """Check if medication has been recalled (informational)."""
        recalls = OpenFDAService.check_drug_recalls(medication_name)

        if recalls:
            recall = recalls[0]  # Most recent recall
            return DrugSafetyAlert(
                patient_id=patient_id,
                alert_type=AlertType.CONTRAINDICATION,
                severity=AlertSeverity.LOW,
                title=f"Drug Recall Information: {medication_name}",
                description=f"This medication has a recall: {recall.get('reason_for_recall', 'See details')}. Classification: {recall.get('classification', 'N/A')}",
                triggering_medication=medication_name
            )

        return None

    @classmethod
    def _get_cached_interaction(cls, drug1_rxcui: str, drug2_rxcui: str) -> Optional[DrugInteractionCache]:
        """Retrieve cached interaction, handling order-independence."""
        # Normalize order (smaller rxcui first)
        if drug1_rxcui > drug2_rxcui:
            drug1_rxcui, drug2_rxcui = drug2_rxcui, drug1_rxcui

        try:
            cache_entry = DrugInteractionCache.objects.filter(
                drug1_rxcui=drug1_rxcui,
                drug2_rxcui=drug2_rxcui
            ).first()

            if cache_entry and not cache_entry.is_expired():
                return cache_entry

            return None
        except Exception as e:
            logger.error(f"Error retrieving cached interaction: {e}")
            return None

    @classmethod
    @transaction.atomic
    def _cache_interaction(cls, drug1_rxcui: str, drug2_rxcui: str, interaction_data: Dict):
        """Cache interaction data."""
        # Normalize order
        if drug1_rxcui > drug2_rxcui:
            drug1_rxcui, drug2_rxcui = drug2_rxcui, drug1_rxcui

        try:
            DrugInteractionCache.objects.update_or_create(
                drug1_rxcui=drug1_rxcui,
                drug2_rxcui=drug2_rxcui,
                defaults={
                    'severity': interaction_data.get('severity', 'unknown'),
                    'description': interaction_data.get('description', ''),
                    'source': interaction_data.get('source', 'RxNorm'),
                    'expires_at': timezone.now() + timedelta(days=30)
                }
            )
        except Exception as e:
            logger.error(f"Error caching interaction: {e}")

    @classmethod
    def _map_severity(cls, api_severity: str) -> AlertSeverity:
        """Map API severity to our AlertSeverity enum."""
        return cls.SEVERITY_MAP.get(api_severity.lower(), AlertSeverity.MODERATE)

    @classmethod
    def _map_allergy_severity_to_alert(cls, allergy_severity: str) -> AlertSeverity:
        """Map PatientAllergy severity to AlertSeverity."""
        mapping = {
            'mild': AlertSeverity.MODERATE,
            'moderate': AlertSeverity.HIGH,
            'severe': AlertSeverity.CRITICAL,
            'life_threatening': AlertSeverity.CRITICAL
        }
        return mapping.get(allergy_severity, AlertSeverity.HIGH)
