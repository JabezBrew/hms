from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


def create_default_roster_version(apps, schema_editor):
    DepartmentRosterPlan = apps.get_model('organization', 'DepartmentRosterPlan')
    DepartmentRosterPlan.objects.filter(version__isnull=True).update(version=1)


class Migration(migrations.Migration):

    dependencies = [
        ('organization', '0010_add_ward_assignment_policy'),
        ('users', '0020_add_session_ip_and_location'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='DepartmentDutyType',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('name', models.CharField(max_length=120)),
                ('code', models.CharField(max_length=40)),
                ('default_context', models.CharField(choices=[('inpatient', 'Inpatient'), ('outpatient', 'Outpatient'), ('emergency', 'Emergency'), ('all', 'All Contexts')], default='inpatient', max_length=20)),
                ('default_role', models.CharField(choices=[('admitting', 'Admitting'), ('covering', 'Covering'), ('consulting', 'Consulting'), ('clinic', 'Clinic'), ('on_call', 'On Call')], default='admitting', max_length=20)),
                ('requires_time_range', models.BooleanField(default=False)),
                ('is_active', models.BooleanField(default=True)),
                ('display_order', models.PositiveSmallIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('department', models.ForeignKey(help_text='Department this duty type belongs to', on_delete=django.db.models.deletion.CASCADE, related_name='duty_types', to='organization.clinicalunit')),
            ],
            options={
                'verbose_name': 'Department Duty Type',
                'verbose_name_plural': 'Department Duty Types',
                'ordering': ['display_order', 'name'],
            },
        ),
        migrations.CreateModel(
            name='DepartmentRosterPlan',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('name', models.CharField(max_length=160)),
                ('cycle_length_days', models.PositiveSmallIntegerField(default=7)),
                ('effective_from', models.DateField()),
                ('effective_until', models.DateField(blank=True, null=True)),
                ('status', models.CharField(choices=[('draft', 'Draft'), ('active', 'Active'), ('archived', 'Archived')], default='draft', max_length=20)),
                ('version', models.PositiveSmallIntegerField(default=1)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_department_roster_plans', to=settings.AUTH_USER_MODEL)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_department_roster_plans', to=settings.AUTH_USER_MODEL)),
                ('department', models.ForeignKey(help_text='Department this roster plan applies to', on_delete=django.db.models.deletion.CASCADE, related_name='roster_plans', to='organization.clinicalunit')),
            ],
            options={
                'verbose_name': 'Department Roster Plan',
                'verbose_name_plural': 'Department Roster Plans',
                'ordering': ['-effective_from', '-version'],
            },
        ),
        migrations.CreateModel(
            name='DepartmentStation',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('name', models.CharField(max_length=120)),
                ('code', models.CharField(max_length=40)),
                ('is_active', models.BooleanField(default=True)),
                ('display_order', models.PositiveSmallIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('department', models.ForeignKey(help_text='Department this station belongs to', on_delete=django.db.models.deletion.CASCADE, related_name='stations', to='organization.clinicalunit')),
            ],
            options={
                'verbose_name': 'Department Station',
                'verbose_name_plural': 'Department Stations',
                'ordering': ['display_order', 'name'],
            },
        ),
        migrations.CreateModel(
            name='RosterPatternSlot',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('day_offset', models.PositiveSmallIntegerField(help_text='0-based day index in the cycle')),
                ('context_override', models.CharField(blank=True, choices=[('inpatient', 'Inpatient'), ('outpatient', 'Outpatient'), ('emergency', 'Emergency'), ('all', 'All Contexts')], max_length=20, null=True)),
                ('role_override', models.CharField(blank=True, choices=[('admitting', 'Admitting'), ('covering', 'Covering'), ('consulting', 'Consulting'), ('clinic', 'Clinic'), ('on_call', 'On Call')], max_length=20, null=True)),
                ('start_time', models.TimeField(blank=True, null=True)),
                ('end_time', models.TimeField(blank=True, null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('duty_type', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='pattern_slots', to='organization.departmentdutytype')),
                ('plan', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='pattern_slots', to='organization.departmentrosterplan')),
                ('team', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='roster_pattern_slots', to='organization.clinicalunit')),
            ],
            options={
                'verbose_name': 'Roster Pattern Slot',
                'verbose_name_plural': 'Roster Pattern Slots',
                'ordering': ['day_offset', 'duty_type__display_order'],
            },
        ),
        migrations.CreateModel(
            name='RosterOverride',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('date', models.DateField()),
                ('context_override', models.CharField(blank=True, choices=[('inpatient', 'Inpatient'), ('outpatient', 'Outpatient'), ('emergency', 'Emergency'), ('all', 'All Contexts')], max_length=20, null=True)),
                ('role_override', models.CharField(blank=True, choices=[('admitting', 'Admitting'), ('covering', 'Covering'), ('consulting', 'Consulting'), ('clinic', 'Clinic'), ('on_call', 'On Call')], max_length=20, null=True)),
                ('start_time', models.TimeField(blank=True, null=True)),
                ('end_time', models.TimeField(blank=True, null=True)),
                ('reason', models.CharField(blank=True, max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_roster_overrides', to=settings.AUTH_USER_MODEL)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_roster_overrides', to=settings.AUTH_USER_MODEL)),
                ('duty_type', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='overrides', to='organization.departmentdutytype')),
                ('plan', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='overrides', to='organization.departmentrosterplan')),
                ('team', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='roster_overrides', to='organization.clinicalunit')),
            ],
            options={
                'verbose_name': 'Roster Override',
                'verbose_name_plural': 'Roster Overrides',
                'ordering': ['date', 'duty_type__display_order'],
            },
        ),
        migrations.CreateModel(
            name='TeamRosterPlan',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('name', models.CharField(max_length=160)),
                ('effective_from', models.DateField()),
                ('effective_until', models.DateField(blank=True, null=True)),
                ('status', models.CharField(choices=[('draft', 'Draft'), ('active', 'Active'), ('archived', 'Archived')], default='draft', max_length=20)),
                ('version', models.PositiveSmallIntegerField(default=1)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_team_roster_plans', to=settings.AUTH_USER_MODEL)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_team_roster_plans', to=settings.AUTH_USER_MODEL)),
                ('department_plan', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='team_roster_plans', to='organization.departmentrosterplan')),
                ('team', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='team_roster_plans', to='organization.clinicalunit')),
            ],
            options={
                'verbose_name': 'Team Roster Plan',
                'verbose_name_plural': 'Team Roster Plans',
                'ordering': ['-effective_from', '-version'],
            },
        ),
        migrations.CreateModel(
            name='TeamRosterEntry',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('date', models.DateField()),
                ('start_time', models.TimeField(blank=True, null=True)),
                ('end_time', models.TimeField(blank=True, null=True)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_team_roster_entries', to=settings.AUTH_USER_MODEL)),
                ('duty_type', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='team_roster_entries', to='organization.departmentdutytype')),
                ('practitioner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='team_roster_entries', to='users.practitionerprofile')),
                ('station', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='team_roster_entries', to='organization.departmentstation')),
                ('team', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='team_roster_entries', to='organization.clinicalunit')),
            ],
            options={
                'verbose_name': 'Team Roster Entry',
                'verbose_name_plural': 'Team Roster Entries',
                'ordering': ['date'],
            },
        ),
        migrations.AddConstraint(
            model_name='departmentdutytype',
            constraint=models.UniqueConstraint(fields=['department', 'code'], name='unique_duty_type_code_per_department'),
        ),
        migrations.AddConstraint(
            model_name='departmentrosterplan',
            constraint=models.CheckConstraint(check=models.Q(('cycle_length_days__gte', 1)), name='department_roster_cycle_length_positive'),
        ),
        migrations.AddConstraint(
            model_name='departmentstation',
            constraint=models.UniqueConstraint(fields=['department', 'code'], name='unique_station_code_per_department'),
        ),
        migrations.AddConstraint(
            model_name='rosteroverride',
            constraint=models.UniqueConstraint(fields=['plan', 'date', 'duty_type'], name='unique_roster_override_per_date'),
        ),
        migrations.AddConstraint(
            model_name='rosterpatternslot',
            constraint=models.UniqueConstraint(fields=['plan', 'day_offset', 'duty_type'], name='unique_roster_slot_per_day'),
        ),
        migrations.AddConstraint(
            model_name='rosterpatternslot',
            constraint=models.CheckConstraint(check=models.Q(('day_offset__gte', 0)), name='roster_slot_day_offset_nonnegative'),
        ),
        migrations.AddConstraint(
            model_name='teamrosterplan',
            constraint=models.CheckConstraint(check=models.Q(('version__gte', 1)), name='team_roster_version_positive'),
        ),
        migrations.AddIndex(
            model_name='departmentdutytype',
            index=models.Index(fields=['department', 'is_active'], name='organization_department_duty_type_active_idx'),
        ),
        migrations.AddIndex(
            model_name='departmentdutytype',
            index=models.Index(fields=['department', 'display_order'], name='organization_department_duty_type_order_idx'),
        ),
        migrations.AddIndex(
            model_name='departmentstation',
            index=models.Index(fields=['department', 'is_active'], name='organization_department_station_active_idx'),
        ),
        migrations.AddIndex(
            model_name='departmentrosterplan',
            index=models.Index(fields=['department', 'status'], name='organization_department_roster_plan_status_idx'),
        ),
        migrations.AddIndex(
            model_name='departmentrosterplan',
            index=models.Index(fields=['department', 'effective_from', 'effective_until'], name='organization_department_roster_plan_dates_idx'),
        ),
        migrations.AddIndex(
            model_name='rosterpatternslot',
            index=models.Index(fields=['plan', 'day_offset'], name='organization_roster_slot_day_idx'),
        ),
        migrations.AddIndex(
            model_name='rosterpatternslot',
            index=models.Index(fields=['plan', 'duty_type'], name='organization_roster_slot_duty_idx'),
        ),
        migrations.AddIndex(
            model_name='rosterpatternslot',
            index=models.Index(fields=['team', 'day_offset'], name='organization_roster_slot_team_idx'),
        ),
        migrations.AddIndex(
            model_name='rosteroverride',
            index=models.Index(fields=['plan', 'date'], name='organization_roster_override_date_idx'),
        ),
        migrations.AddIndex(
            model_name='rosteroverride',
            index=models.Index(fields=['plan', 'duty_type'], name='organization_roster_override_duty_idx'),
        ),
        migrations.AddIndex(
            model_name='teamrosterplan',
            index=models.Index(fields=['team', 'status'], name='organization_team_roster_plan_status_idx'),
        ),
        migrations.AddIndex(
            model_name='teamrosterplan',
            index=models.Index(fields=['team', 'effective_from', 'effective_until'], name='organization_team_roster_plan_dates_idx'),
        ),
        migrations.AddIndex(
            model_name='teamrosterentry',
            index=models.Index(fields=['team', 'date'], name='organization_team_roster_entry_date_idx'),
        ),
        migrations.AddIndex(
            model_name='teamrosterentry',
            index=models.Index(fields=['team', 'duty_type', 'date'], name='organization_team_roster_entry_duty_idx'),
        ),
        migrations.AddIndex(
            model_name='teamrosterentry',
            index=models.Index(fields=['practitioner', 'date'], name='organization_team_roster_entry_pract_idx'),
        ),
        migrations.RunPython(create_default_roster_version, migrations.RunPython.noop),
    ]
