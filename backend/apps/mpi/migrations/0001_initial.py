from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='PatientIdentity',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('first_name', models.CharField(max_length=100)),
                ('last_name', models.CharField(max_length=100)),
                ('date_of_birth', models.DateField()),
                ('gender', models.CharField(blank=True, max_length=20)),
                ('nhis_id', models.CharField(blank=True, max_length=50)),
                ('phone', models.CharField(blank=True, max_length=20)),
                ('email', models.EmailField(blank=True, max_length=254)),
                ('is_active', models.BooleanField(default=True)),
                ('created_by_facility_code', models.CharField(blank=True, max_length=20)),
                ('created_by_user_id', models.UUIDField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['last_name', 'first_name'],
                'verbose_name': 'Patient Identity',
                'verbose_name_plural': 'Patient Identities',
            },
        ),
        migrations.CreateModel(
            name='PatientFacilityLink',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('facility_code', models.CharField(max_length=20)),
                ('facility_patient_id', models.UUIDField()),
                ('is_active', models.BooleanField(default=True)),
                ('linked_at', models.DateTimeField(auto_now_add=True)),
                ('last_seen_at', models.DateTimeField(auto_now=True)),
                ('created_by_facility_code', models.CharField(blank=True, max_length=20)),
                ('created_by_user_id', models.UUIDField(blank=True, null=True)),
                ('patient_identity', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='facility_links', to='mpi.patientidentity')),
            ],
            options={
                'verbose_name': 'Patient Facility Link',
                'verbose_name_plural': 'Patient Facility Links',
            },
        ),
        migrations.AddIndex(
            model_name='patientidentity',
            index=models.Index(fields=['nhis_id'], name='mpi_patien_nhis_id_7c5ea3_idx'),
        ),
        migrations.AddIndex(
            model_name='patientidentity',
            index=models.Index(fields=['last_name', 'first_name', 'date_of_birth'], name='mpi_patien_last_na_b8cb5a_idx'),
        ),
        migrations.AddConstraint(
            model_name='patientidentity',
            constraint=models.UniqueConstraint(condition=models.Q(('nhis_id', ''), _negated=True), fields=('nhis_id',), name='mpi_unique_nhis_id'),
        ),
        migrations.AddIndex(
            model_name='patientfacilitylink',
            index=models.Index(fields=['facility_code', 'facility_patient_id'], name='mpi_patien_facilit_74bba1_idx'),
        ),
        migrations.AddIndex(
            model_name='patientfacilitylink',
            index=models.Index(fields=['patient_identity', 'facility_code'], name='mpi_patien_patient_8c8d8a_idx'),
        ),
        migrations.AddConstraint(
            model_name='patientfacilitylink',
            constraint=models.UniqueConstraint(fields=('patient_identity', 'facility_code'), name='mpi_unique_identity_facility_link'),
        ),
    ]
