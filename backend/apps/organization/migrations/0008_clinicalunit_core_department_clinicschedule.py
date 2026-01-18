from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0009_facility_status_fields'),
        ('organization', '0007_clinic_clinic_unique_clinic_code_per_facility'),
    ]

    operations = [
        migrations.AddField(
            model_name='clinicalunit',
            name='core_department',
            field=models.ForeignKey(
                blank=True,
                help_text='Mapped facility department for registration and reporting',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='clinical_units',
                to='core.department',
            ),
        ),
        migrations.CreateModel(
            name='ClinicSchedule',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('day_of_week', models.PositiveSmallIntegerField(choices=[(0, 'Monday'), (1, 'Tuesday'), (2, 'Wednesday'), (3, 'Thursday'), (4, 'Friday'), (5, 'Saturday'), (6, 'Sunday')])),
                ('start_time', models.TimeField()),
                ('end_time', models.TimeField()),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('clinic', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='schedules', to='organization.clinic')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_clinic_schedules', to='users.user')),
                ('department', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='clinic_schedules', to='organization.clinicalunit')),
                ('facility', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='clinic_schedules', to='core.facility')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_clinic_schedules', to='users.user')),
            ],
            options={
                'ordering': ['day_of_week', 'start_time'],
            },
        ),
        migrations.AddIndex(
            model_name='clinicalunit',
            index=models.Index(fields=['core_department', 'is_active'], name='organizatio_core_de_5c14fd_idx'),
        ),
        migrations.AddIndex(
            model_name='clinicschedule',
            index=models.Index(fields=['facility', 'day_of_week', 'is_active'], name='organizatio_facility_f9f403_idx'),
        ),
        migrations.AddIndex(
            model_name='clinicschedule',
            index=models.Index(fields=['department', 'day_of_week', 'is_active'], name='organizatio_departme_5c5b8a_idx'),
        ),
        migrations.AddIndex(
            model_name='clinicschedule',
            index=models.Index(fields=['clinic', 'day_of_week', 'is_active'], name='organizatio_clinic_237153_idx'),
        ),
    ]
