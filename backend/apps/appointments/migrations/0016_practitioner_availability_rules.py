import uuid

import django.contrib.postgres.fields
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def copy_recurring_schedules_to_personal_rules(apps, schema_editor):
    RecurringSchedule = apps.get_model('appointments', 'RecurringSchedule')
    PractitionerAvailabilityRule = apps.get_model('appointments', 'PractitionerAvailabilityRule')

    rules = []
    for schedule in RecurringSchedule.objects.all().iterator():
        rules.append(PractitionerAvailabilityRule(
            id=uuid.uuid4(),
            facility_id=schedule.facility_id,
            practitioner_id=schedule.practitioner_id,
            clinic_id=None,
            name=schedule.name,
            days_of_week=schedule.days_of_week,
            start_time=schedule.start_time,
            end_time=schedule.end_time,
            slot_duration=schedule.slot_duration,
            active_from=schedule.active_from,
            active_to=schedule.active_to,
            breaks=schedule.breaks,
            is_active=schedule.is_active,
            template_key=schedule.template_key,
            template_name=schedule.template_name,
            created_at=schedule.created_at,
            updated_at=schedule.updated_at,
            created_by_id=schedule.created_by_id,
            updated_by_id=schedule.updated_by_id,
        ))

    if rules:
        PractitionerAvailabilityRule.objects.bulk_create(rules, batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('appointments', '0015_search_index'),
        ('core', '0011_feature_entitlement_override'),
        ('organization', '0021_clinic_assignment_timing_clinic_booking_mode_and_more'),
        ('users', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='PractitionerAvailabilityRule',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=100)),
                ('days_of_week', django.contrib.postgres.fields.ArrayField(base_field=models.IntegerField(), help_text='List of days (0=Monday, 6=Sunday)', size=None)),
                ('start_time', models.TimeField()),
                ('end_time', models.TimeField()),
                ('slot_duration', models.IntegerField(help_text='Duration in minutes')),
                ('active_from', models.DateField()),
                ('active_to', models.DateField(blank=True, null=True)),
                ('breaks', models.JSONField(blank=True, default=list, help_text="List of break times, e.g. [{'start': '12:00', 'end': '13:00'}]")),
                ('is_active', models.BooleanField(default=True)),
                ('template_key', models.UUIDField(blank=True, db_index=True, help_text='Shared template key when this rule was cloned to multiple practitioners', null=True)),
                ('template_name', models.CharField(blank=True, help_text='Optional display name for the shared personal calendar template', max_length=120, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('clinic', models.ForeignKey(blank=True, help_text='Optional clinic this personal availability applies to', null=True, on_delete=django.db.models.deletion.PROTECT, related_name='practitioner_availability_rules', to='organization.clinic')),
                ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_availability_rules', to=settings.AUTH_USER_MODEL)),
                ('facility', models.ForeignKey(help_text='Facility where this availability applies', on_delete=django.db.models.deletion.PROTECT, related_name='practitioner_availability_rules', to='core.facility')),
                ('practitioner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='availability_rules', to='users.practitionerprofile')),
                ('updated_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_availability_rules', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='practitioneravailabilityrule',
            index=models.Index(fields=['facility', 'is_active'], name='appointment_facilit_07cac5_idx'),
        ),
        migrations.AddIndex(
            model_name='practitioneravailabilityrule',
            index=models.Index(fields=['clinic', 'is_active'], name='appointment_clinic__1401dc_idx'),
        ),
        migrations.AddIndex(
            model_name='practitioneravailabilityrule',
            index=models.Index(fields=['practitioner', 'is_active', 'active_from'], name='appointment_practit_aa06be_idx'),
        ),
        migrations.AddIndex(
            model_name='practitioneravailabilityrule',
            index=models.Index(fields=['facility', 'template_key'], name='appointment_facilit_f1ea76_idx'),
        ),
        migrations.AddIndex(
            model_name='practitioneravailabilityrule',
            index=models.Index(fields=['days_of_week'], name='appointment_days_of_03b882_idx'),
        ),
        migrations.RunPython(copy_recurring_schedules_to_personal_rules, migrations.RunPython.noop),
        migrations.DeleteModel(
            name='RecurringSchedule',
        ),
    ]
