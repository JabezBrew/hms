"""
Pharmacy serializers for medication dispensing workflow.
"""
from rest_framework import serializers
from apps.nursing.models import MedicationAdministration, SupplyRequest


class MedicationDispensingListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for pharmacy dispensing queue.
    Includes safety information for pharmacists (allergies, problems, other meds).
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    patient_ward = serializers.CharField(source='patient.current_ward', read_only=True)
    prescriber_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    is_overdue = serializers.SerializerMethodField()
    # Safety information for pharmacists
    patient_allergies = serializers.SerializerMethodField()
    patient_problems = serializers.SerializerMethodField()
    patient_medications = serializers.SerializerMethodField()

    class Meta:
        model = MedicationAdministration
        fields = [
            'id', 'patient', 'patient_name', 'patient_mrn', 'patient_ward',
            'medication_name', 'dosage', 'route', 'frequency',
            'scheduled_time', 'status', 'status_display',
            'prescriber_name', 'prescription', 'is_dispensed', 'is_overdue',
            # Safety info
            'patient_allergies', 'patient_problems', 'patient_medications'
        ]

    def get_patient_name(self, obj):
        """Get patient full name."""
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return 'Unknown Patient'

    def get_prescriber_name(self, obj):
        """Get prescriber full name."""
        if obj.prescribed_by and obj.prescribed_by.staff and obj.prescribed_by.staff.user:
            return f"Dr. {obj.prescribed_by.staff.user.get_full_name()}"
        return None

    def get_is_overdue(self, obj):
        """Check if medication is past its scheduled time."""
        from django.utils import timezone
        if obj.scheduled_time:
            return obj.scheduled_time < timezone.now()
        return False

    def get_patient_allergies(self, obj):
        """Get patient allergies for drug safety check."""
        if not obj.patient:
            return []
        allergies_text = obj.patient.allergies or ''
        if not allergies_text:
            return []
        # Parse allergies (could be comma, semicolon, or newline separated)
        for sep in [',', ';', '\n']:
            if sep in allergies_text:
                return [a.strip() for a in allergies_text.split(sep) if a.strip()]
        return [allergies_text.strip()] if allergies_text.strip() else []

    def get_patient_problems(self, obj):
        """Get active patient problems/diagnoses for contraindication check."""
        if not obj.patient:
            return []
        # Get problems from recent clinical notes
        from apps.clinical_notes.models import NoteEntry
        from django.utils import timezone
        from datetime import timedelta

        problems = []
        seen = set()

        # Look at recent notes (last 90 days)
        notes = NoteEntry.objects.filter(
            patient=obj.patient,
            created_at__gte=timezone.now() - timedelta(days=90)
        ).order_by('-created_at')[:10]

        for note in notes:
            data = note.data or {}
            assessment = data.get('Assessment', {})
            if isinstance(assessment, dict):
                primary_dx = assessment.get('Primary Diagnosis', '')
                if primary_dx and primary_dx.strip().lower() not in seen:
                    seen.add(primary_dx.strip().lower())
                    problems.append(primary_dx.strip())
        return problems[:5]  # Limit to 5 most recent

    def get_patient_medications(self, obj):
        """Get other active medications for drug interaction check."""
        if not obj.patient:
            return []
        from apps.clinical_notes.models import Prescription
        from django.utils import timezone
        from django.db.models import Q

        # Get active prescriptions, excluding the current medication
        active_meds = Prescription.objects.filter(
            patient=obj.patient,
            status='active'
        ).filter(
            Q(end_date__gte=timezone.now().date()) |
            Q(end_date__isnull=True)
        ).exclude(
            medication_name=obj.medication_name
        ).values_list('medication_name', flat=True)[:10]

        return list(active_meds)


class SupplyRequestDispensingSerializer(serializers.ModelSerializer):
    """
    Serializer for pharmacy view of supply requests.
    """
    medication_name = serializers.SerializerMethodField()
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.SerializerMethodField()
    ward_name = serializers.SerializerMethodField()
    requested_by_name = serializers.SerializerMethodField()

    class Meta:
        model = SupplyRequest
        fields = [
            'id', 'treatment_entry', 'medication_name',
            'patient_name', 'patient_mrn', 'ward_name',
            'quantity_requested', 'quantity_dispensed', 'status',
            'requested_by_name', 'requested_at', 'notes'
        ]

    def get_medication_name(self, obj):
        return obj.treatment_entry.medication_name

    def get_patient_name(self, obj):
        if obj.treatment_entry.patient and obj.treatment_entry.patient.user:
            return obj.treatment_entry.patient.user.get_full_name()
        return 'Unknown Patient'

    def get_patient_mrn(self, obj):
        if obj.treatment_entry.patient:
            return obj.treatment_entry.patient.medical_record_number
        return None

    def get_ward_name(self, obj):
        if obj.treatment_entry.admission and obj.treatment_entry.admission.bed:
            return obj.treatment_entry.admission.bed.ward.name
        return 'Unknown'

    def get_requested_by_name(self, obj):
        if obj.requested_by and obj.requested_by.staff and obj.requested_by.staff.user:
            return obj.requested_by.staff.user.get_full_name()
        return 'Unknown'
