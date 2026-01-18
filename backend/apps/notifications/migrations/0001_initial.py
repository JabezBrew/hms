
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0009_facility_status_fields'),
        ('users', '0019_rename_users_sess_refresh_jti_idx_users_users_refresh_f5b1e9_idx_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='InboxItem',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('recipient_role', models.CharField(blank=True, max_length=30)),
                ('source_type', models.CharField(choices=[('referral', 'Referral'), ('nursing_alert', 'Nursing Alert'), ('nursing_task', 'Nursing Task'), ('drug_safety', 'Drug Safety'), ('lab_result', 'Lab Result')], max_length=30)),
                ('source_id', models.UUIDField()),
                ('title', models.CharField(max_length=200)),
                ('summary', models.CharField(blank=True, max_length=500)),
                ('action_url', models.CharField(blank=True, max_length=255)),
                ('priority', models.CharField(choices=[('routine', 'Routine'), ('normal', 'Normal'), ('urgent', 'Urgent'), ('emergency', 'Emergency')], default='normal', max_length=20)),
                ('status', models.CharField(choices=[('unread', 'Unread'), ('read', 'Read'), ('acknowledged', 'Acknowledged'), ('done', 'Done'), ('dismissed', 'Dismissed')], default='unread', max_length=20)),
                ('is_action_required', models.BooleanField(default=False)),
                ('is_read', models.BooleanField(default=False)),
                ('occurred_at', models.DateTimeField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('dedupe_key', models.CharField(blank=True, db_index=True, max_length=200)),
                ('facility', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='inbox_items', to='core.facility')),
                ('patient', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='inbox_items', to='users.patientprofile')),
                ('recipient_user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='inbox_items', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-occurred_at'],
                'indexes': [
                    models.Index(fields=['recipient_user', 'status', '-occurred_at'], name='notificat_recipient_2b0d44_idx'),
                    models.Index(fields=['recipient_role', 'facility', 'status', '-occurred_at'], name='notificat_recipient_8a5250_idx'),
                    models.Index(fields=['facility', 'status', '-occurred_at'], name='notificat_facility_eb3582_idx'),
                    models.Index(fields=['patient', '-occurred_at'], name='notificat_patient_24e8d7_idx'),
                    models.Index(fields=['source_type', 'source_id'], name='notificat_source_t_d8f778_idx'),
                ],
                'constraints': [
                    models.UniqueConstraint(fields=('recipient_user', 'recipient_role', 'source_type', 'source_id'), name='notifications_inbox_item_user_source_unique'),
                    models.UniqueConstraint(fields=('recipient_role', 'source_type', 'source_id', 'dedupe_key'), name='notifications_inbox_item_role_source_unique'),
                ],
            },
        ),
    ]
