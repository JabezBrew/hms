import uuid

from django.db import models
from django.db.models import Q


class PatientIdentity(models.Model):
    """
    MPI record for a patient across facilities.

    Contains minimal identity attributes (no clinical data).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    date_of_birth = models.DateField()
    gender = models.CharField(max_length=20, blank=True)
    nhis_id = models.CharField(max_length=50, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    is_active = models.BooleanField(default=True)

    created_by_facility_code = models.CharField(max_length=20, blank=True)
    created_by_user_id = models.UUIDField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['nhis_id']),
            models.Index(fields=['last_name', 'first_name', 'date_of_birth']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['nhis_id'],
                condition=~Q(nhis_id=''),
                name='mpi_unique_nhis_id'
            ),
        ]
        ordering = ['last_name', 'first_name']
        verbose_name = 'Patient Identity'
        verbose_name_plural = 'Patient Identities'

    def __str__(self):
        return f"{self.last_name}, {self.first_name} ({self.date_of_birth})"


class PatientFacilityLink(models.Model):
    """
    Link between MPI identity and a facility-local patient record.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient_identity = models.ForeignKey(
        PatientIdentity,
        on_delete=models.CASCADE,
        related_name='facility_links'
    )
    facility_code = models.CharField(max_length=20)
    facility_patient_id = models.UUIDField()
    is_active = models.BooleanField(default=True)
    linked_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)

    created_by_facility_code = models.CharField(max_length=20, blank=True)
    created_by_user_id = models.UUIDField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['facility_code', 'facility_patient_id']),
            models.Index(fields=['patient_identity', 'facility_code']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['patient_identity', 'facility_code'],
                name='mpi_unique_identity_facility_link'
            ),
        ]
        verbose_name = 'Patient Facility Link'
        verbose_name_plural = 'Patient Facility Links'

    def __str__(self):
        return f"{self.facility_code}:{self.patient_identity_id}"
