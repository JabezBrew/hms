import uuid
from django.db import models
from django.contrib.auth import get_user_model
from ..users.models import PractitionerProfile
from ..wards.proxies import EncounterProxy

User = get_user_model()


class NoteTemplate(models.Model):
    """
    Model for clinical note templates.
    Stores reusable form templates with a JSON structure.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=100)  # e.g., "SOAP Note", "Nurse Shift Note"
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    is_public = models.BooleanField(default=False)  # If true, the template is available to everyone
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_templates')
    structure = models.JSONField()  # JSON schema-like definition

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_templates')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title


class NoteEntry(models.Model):
    """
    Model for submitted clinical note entries.
    Links to a template, patient encounter, and practitioner.
    Stores the actual values entered for each section.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(NoteTemplate, on_delete=models.CASCADE, related_name='entries')
    encounter_id = models.CharField(max_length=100)  # FHIR Encounter ID
    practitioner = models.ForeignKey(PractitionerProfile, on_delete=models.CASCADE, related_name='note_entries')
    composition_fhir_id = models.CharField(max_length=100, null=True, blank=True)  # FHIR Composition ID
    data = models.JSONField()  # Actual values entered for each section

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name_plural = 'Note entries'

    def __str__(self):
        return f"{self.template.title} for Encounter {self.encounter_id}"

    @property
    def encounter(self):
        """
        Get the FHIR Encounter resource.
        """
        if not hasattr(self, '_encounter'):
            try:
                self._encounter = EncounterProxy.get(self.encounter_id)
            except Exception as e:
                # Log the error but don't raise it
                import logging
                logger = logging.getLogger(__name__)
                logger.error(f"Error fetching encounter {self.encounter_id}: {str(e)}")
                self._encounter = None
        return self._encounter
