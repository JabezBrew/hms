import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.db.models import Q
from django.utils import timezone


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0011_feature_entitlement_override'),
        ('users', '0026_merge_users_migration_branches'),
        ('wards', '0020_alter_admission_status'),
    ]

    operations = [
        migrations.CreateModel(
            name='WardBoardTask',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('category', models.CharField(choices=[('admission', 'Admission'), ('assessment', 'Assessment'), ('discharge', 'Discharge'), ('documentation', 'Documentation'), ('lab', 'Lab'), ('medication', 'Medication'), ('mobility', 'Mobility'), ('review', 'Review'), ('safety', 'Safety'), ('vitals', 'Vitals'), ('other', 'Other')], default='other', max_length=32)),
                ('priority', models.CharField(choices=[('routine', 'Routine'), ('important', 'Important'), ('urgent', 'Urgent'), ('stat', 'STAT')], default='routine', max_length=16)),
                ('status', models.CharField(choices=[('open', 'Open'), ('in_progress', 'In Progress'), ('escalated', 'Escalated'), ('completed', 'Completed'), ('cancelled', 'Cancelled')], default='open', max_length=20)),
                ('owner_role', models.CharField(blank=True, max_length=30)),
                ('due_at', models.DateTimeField(blank=True, null=True)),
                ('action_text', models.TextField()),
                ('contingency_text', models.TextField(blank=True)),
                ('source_type', models.CharField(choices=[('manual', 'Manual'), ('admission_task', 'Admission Task'), ('discharge_task', 'Discharge Task'), ('lab_order', 'Lab Order'), ('nursing_alert', 'Nursing Alert'), ('nursing_task', 'Nursing Task'), ('system', 'System')], default='manual', max_length=32)),
                ('source_id', models.CharField(blank=True, max_length=64)),
                ('cancellation_reason', models.TextField(blank=True)),
                ('escalated_at', models.DateTimeField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('cancelled_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('admission', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='ward_board_tasks', to='wards.admission')),
                ('cancelled_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='cancelled_ward_board_tasks', to=settings.AUTH_USER_MODEL)),
                ('completed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='completed_ward_board_tasks', to=settings.AUTH_USER_MODEL)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_ward_board_tasks', to=settings.AUTH_USER_MODEL)),
                ('facility', models.ForeignKey(help_text='Facility context for this ward-board task.', on_delete=django.db.models.deletion.PROTECT, related_name='ward_board_tasks', to='core.facility')),
                ('owner_user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='owned_ward_board_tasks', to=settings.AUTH_USER_MODEL)),
                ('patient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='ward_board_tasks', to='users.patientprofile')),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_ward_board_tasks', to=settings.AUTH_USER_MODEL)),
                ('ward', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='ward_board_tasks', to='wards.ward')),
            ],
            options={
                'ordering': ['status', 'due_at', '-priority', '-created_at'],
            },
        ),
        migrations.CreateModel(
            name='WardBoardTaskEvent',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('event_type', models.CharField(choices=[('create', 'Create'), ('update', 'Update'), ('acknowledge', 'Acknowledge'), ('assign', 'Assign'), ('complete', 'Complete'), ('cancel', 'Cancel'), ('escalate', 'Escalate')], max_length=24)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('actor', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='ward_board_task_events', to=settings.AUTH_USER_MODEL)),
                ('facility', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='ward_board_task_events', to='core.facility')),
                ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='events', to='ward_board.wardboardtask')),
            ],
            options={
                'ordering': ['created_at'],
            },
        ),
        migrations.CreateModel(
            name='WardBoardAcknowledgement',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('acknowledged_at', models.DateTimeField(default=timezone.now)),
                ('note', models.TextField(blank=True)),
                ('facility', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='ward_board_acknowledgements', to='core.facility')),
                ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='acknowledgements', to='ward_board.wardboardtask')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='ward_board_acknowledgements', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-acknowledged_at'],
            },
        ),
        migrations.AddIndex(
            model_name='wardboardtask',
            index=models.Index(fields=['facility', 'status', 'due_at'], name='wb_task_fac_status_due_idx'),
        ),
        migrations.AddIndex(
            model_name='wardboardtask',
            index=models.Index(fields=['facility', 'priority', 'due_at'], name='wb_task_fac_priority_due_idx'),
        ),
        migrations.AddIndex(
            model_name='wardboardtask',
            index=models.Index(fields=['patient', 'status'], name='wb_task_patient_status_idx'),
        ),
        migrations.AddIndex(
            model_name='wardboardtask',
            index=models.Index(fields=['admission', 'status'], name='wb_task_adm_status_idx'),
        ),
        migrations.AddIndex(
            model_name='wardboardtask',
            index=models.Index(fields=['ward', 'status', 'due_at'], name='wb_task_ward_status_due_idx'),
        ),
        migrations.AddIndex(
            model_name='wardboardtask',
            index=models.Index(fields=['owner_role', 'status', 'due_at'], name='wb_task_owner_role_idx'),
        ),
        migrations.AddIndex(
            model_name='wardboardtask',
            index=models.Index(fields=['source_type', 'source_id'], name='wb_task_source_idx'),
        ),
        migrations.AddConstraint(
            model_name='wardboardtask',
            constraint=models.CheckConstraint(check=(Q(('owner_role', ''), ('owner_user__isnull', False)) | (Q(('owner_user__isnull', True)) & ~Q(('owner_role', '')))), name='wb_task_owner_xor_chk'),
        ),
        migrations.AddConstraint(
            model_name='wardboardtask',
            constraint=models.UniqueConstraint(condition=~Q(('source_id', '')), fields=('facility', 'source_type', 'source_id'), name='wb_task_source_uniq'),
        ),
        migrations.AddIndex(
            model_name='wardboardtaskevent',
            index=models.Index(fields=['task', 'created_at'], name='wb_event_task_created_idx'),
        ),
        migrations.AddIndex(
            model_name='wardboardtaskevent',
            index=models.Index(fields=['facility', 'created_at'], name='wb_event_fac_created_idx'),
        ),
        migrations.AddIndex(
            model_name='wardboardtaskevent',
            index=models.Index(fields=['actor', 'created_at'], name='wb_event_actor_created_idx'),
        ),
        migrations.AddIndex(
            model_name='wardboardacknowledgement',
            index=models.Index(fields=['task', 'acknowledged_at'], name='wb_ack_task_at_idx'),
        ),
        migrations.AddIndex(
            model_name='wardboardacknowledgement',
            index=models.Index(fields=['user', 'acknowledged_at'], name='wb_ack_user_at_idx'),
        ),
        migrations.AddIndex(
            model_name='wardboardacknowledgement',
            index=models.Index(fields=['facility', 'acknowledged_at'], name='wb_ack_fac_at_idx'),
        ),
        migrations.AddConstraint(
            model_name='wardboardacknowledgement',
            constraint=models.UniqueConstraint(fields=('task', 'user'), name='wb_ack_task_user_uniq'),
        ),
    ]
