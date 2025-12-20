# Migration to move Encounter model from wards to encounters app
# Uses SeparateDatabaseAndState to avoid data loss

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone
import uuid


class Migration(migrations.Migration):
    """
    This migration moves the Encounter model from wards app to encounters app.

    It uses SeparateDatabaseAndState to:
    1. Tell Django that encounters.Encounter now exists (state_operations)
    2. Not touch the database since the table already exists (no database_operations)
    """

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('users', '0004_user_gender'),
        ('wards', '0012_fix_ward_department_hierarchy'),  # Depend on latest wards migration
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name='Encounter',
                    fields=[
                        ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                        ('encounter_type', models.CharField(choices=[('inpatient', 'Inpatient'), ('outpatient', 'Outpatient'), ('emergency', 'Emergency')], default='outpatient', max_length=20)),
                        ('status', models.CharField(choices=[('planned', 'Planned'), ('in-progress', 'In Progress'), ('finished', 'Finished'), ('cancelled', 'Cancelled')], default='planned', max_length=20)),
                        ('start_time', models.DateTimeField(default=django.utils.timezone.now)),
                        ('end_time', models.DateTimeField(blank=True, null=True)),
                        ('reason', models.TextField(blank=True, help_text='Chief complaint or reason for visit', null=True)),
                        ('service_type', models.CharField(blank=True, help_text='Type of service (e.g., General Practice, Cardiology)', max_length=100, null=True)),
                        ('location', models.CharField(blank=True, help_text='Ward, clinic, or room', max_length=200, null=True)),
                        ('admission_source', models.CharField(blank=True, max_length=50, null=True)),
                        ('discharge_disposition', models.CharField(blank=True, max_length=50, null=True)),
                        ('destination', models.CharField(blank=True, max_length=200, null=True)),
                        ('fhir_id', models.CharField(blank=True, help_text='FHIR Encounter resource ID', max_length=100, null=True, unique=True)),
                        ('fhir_synced', models.BooleanField(default=False, help_text='Whether this encounter has been synced to FHIR')),
                        ('fhir_last_synced', models.DateTimeField(blank=True, help_text='Last successful FHIR sync time', null=True)),
                        ('fhir_sync_error', models.TextField(blank=True, help_text='Last FHIR sync error message', null=True)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                        ('admission', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='encounter', to='wards.admission')),
                        ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_encounters', to=settings.AUTH_USER_MODEL)),
                        ('patient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='encounters', to='users.patientprofile')),
                        ('practitioner', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='encounters', to='users.practitionerprofile')),
                        ('updated_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_encounters', to=settings.AUTH_USER_MODEL)),
                    ],
                    options={
                        'ordering': ['-start_time'],
                        'db_table': 'wards_encounter',
                        'indexes': [
                            models.Index(fields=['patient', 'status'], name='wards_encou_patient_a832b2_idx'),
                            models.Index(fields=['practitioner', 'status'], name='wards_encou_practit_e3488b_idx'),
                            models.Index(fields=['status', 'start_time'], name='wards_encou_status_111352_idx'),
                            models.Index(fields=['encounter_type', 'status'], name='wards_encou_encount_c58fa3_idx'),
                            models.Index(fields=['fhir_id'], name='wards_encou_fhir_id_4edcbb_idx'),
                            models.Index(fields=['fhir_synced'], name='wards_encou_fhir_sy_77863d_idx'),
                            models.Index(fields=['start_time'], name='wards_encou_start_t_cf26fe_idx'),
                        ],
                    },
                ),
            ],
            database_operations=[],  # No database operations - table already exists
        ),
    ]
