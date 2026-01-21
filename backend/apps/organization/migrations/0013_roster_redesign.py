"""Roster redesign: simplify models and endpoints."""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('organization', '0012_departmentrosterpattern_and_more'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='departmentdutytype',
            name='default_context',
        ),
        migrations.RemoveField(
            model_name='departmentdutytype',
            name='default_context_label',
        ),
        migrations.RemoveField(
            model_name='departmentdutytype',
            name='default_role',
        ),
        migrations.RemoveField(
            model_name='departmentdutytype',
            name='default_role_label',
        ),
        migrations.RemoveField(
            model_name='departmentdutytype',
            name='requires_time_range',
        ),
        migrations.AddField(
            model_name='departmentdutytype',
            name='rotation_type',
            field=models.CharField(choices=[('sequential', 'Sequential'), ('fixed_weekly', 'Fixed Weekly'), ('none', 'No Rotation')], default='sequential', max_length=20),
        ),
        migrations.AddField(
            model_name='departmentdutytype',
            name='applicable_days',
            field=models.JSONField(default=list),
        ),
        migrations.AddField(
            model_name='departmentdutytype',
            name='is_24_hour',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='departmentdutytype',
            name='start_time',
            field=models.TimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='departmentdutytype',
            name='end_time',
            field=models.TimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name='RotationRule',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=120)),
                ('rule_type', models.CharField(choices=[('sequential', 'Simple Sequential'), ('fixed_weekly', 'Fixed Weekly Pattern'), ('exclusion', 'Sequential with Exclusion')], max_length=20)),
                ('team_sequence', models.JSONField(default=list)),
                ('day_assignments', models.JSONField(default=dict)),
                ('exclusion_rule', models.JSONField(blank=True, null=True)),
                ('applicable_days', models.JSONField(default=list)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_rotation_rules', to=settings.AUTH_USER_MODEL)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_rotation_rules', to=settings.AUTH_USER_MODEL)),
                ('department', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='rotation_rules', to='organization.clinicalunit')),
                ('duty_type', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='rotation_rules', to='organization.departmentdutytype')),
            ],
            options={
                'ordering': ['name'],
                'verbose_name': 'Rotation Rule',
                'verbose_name_plural': 'Rotation Rules',
            },
        ),
        migrations.CreateModel(
            name='RosterEntry',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('date', models.DateField()),
                ('start_time', models.TimeField(blank=True, null=True)),
                ('end_time', models.TimeField(blank=True, null=True)),
                ('source', models.CharField(choices=[('generated', 'Auto-generated from rules'), ('manual', 'Manually entered'), ('imported', 'Imported from CSV'), ('override', 'Override')], max_length=20)),
                ('is_override', models.BooleanField(default=False)),
                ('override_reason', models.CharField(blank=True, max_length=255)),
                ('status', models.CharField(choices=[('draft', 'Draft'), ('published', 'Published')], default='draft', max_length=20)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_roster_entries', to=settings.AUTH_USER_MODEL)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_roster_entries', to=settings.AUTH_USER_MODEL)),
                ('department', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='department_roster_entries', to='organization.clinicalunit')),
                ('duty_type', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='roster_entries', to='organization.departmentdutytype')),
                ('original_team', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='overridden_roster_entries', to='organization.clinicalunit')),
                ('practitioner', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='practitioner_roster_entries', to='users.practitionerprofile')),
                ('team', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='team_roster_entries', to='organization.clinicalunit')),
            ],
            options={
                'ordering': ['date', 'duty_type__display_order'],
                'verbose_name': 'Roster Entry',
                'verbose_name_plural': 'Roster Entries',
            },
        ),
        migrations.AddIndex(
            model_name='rotationrule',
            index=models.Index(fields=['department', 'is_active'], name='organizat_departe_1d0f1f_idx'),
        ),
        migrations.AddIndex(
            model_name='rotationrule',
            index=models.Index(fields=['department', 'duty_type', 'is_active'], name='organizat_departe_5d5d2d_idx'),
        ),
        migrations.AddIndex(
            model_name='rosterentry',
            index=models.Index(fields=['department', 'date'], name='organizat_departe_2d084d_idx'),
        ),
        migrations.AddIndex(
            model_name='rosterentry',
            index=models.Index(fields=['department', 'duty_type', 'date'], name='organizat_departe_6f0a4c_idx'),
        ),
        migrations.AddIndex(
            model_name='rosterentry',
            index=models.Index(fields=['team', 'date'], name='organizat_team_da_8ed1f1_idx'),
        ),
        migrations.AddIndex(
            model_name='rosterentry',
            index=models.Index(fields=['date', 'status'], name='organizat_date_st_5efba5_idx'),
        ),
        migrations.AddConstraint(
            model_name='rosterentry',
            constraint=models.UniqueConstraint(fields=('department', 'duty_type', 'date'), name='unique_roster_entry'),
        ),
        migrations.AddConstraint(
            model_name='rosterentry',
            constraint=models.CheckConstraint(check=models.Q(models.Q(('team__isnull', False), ('practitioner__isnull', True)), models.Q(('team__isnull', True), ('practitioner__isnull', False)), _connector='OR'), name='roster_entry_team_or_practitioner'),
        ),
        migrations.DeleteModel(name='TeamRosterEntry'),
        migrations.DeleteModel(name='TeamRosterPlan'),
        migrations.DeleteModel(name='RosterOverride'),
        migrations.DeleteModel(name='RosterPatternSlot'),
        migrations.DeleteModel(name='DepartmentRosterPattern'),
        migrations.DeleteModel(name='DepartmentRosterPlan'),
        migrations.DeleteModel(name='DepartmentStation'),
        migrations.DeleteModel(name='DutyRoster'),
        migrations.DeleteModel(name='DutyRosterTemplate'),
        migrations.DeleteModel(name='ShiftDefinition'),
    ]
