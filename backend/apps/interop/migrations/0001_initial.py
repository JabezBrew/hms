from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ('users', '0011_patient_identity_id'),
    ]

    operations = [
        migrations.CreateModel(
            name='RecordExportJob',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('patient_identity_id', models.UUIDField(blank=True, db_index=True, null=True)),
                ('target_facility_code', models.CharField(max_length=20)),
                ('consent_grant_id', models.UUIDField(blank=True, null=True)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('running', 'Running'), ('ready', 'Ready'), ('failed', 'Failed'), ('delivered', 'Delivered')], default='pending', max_length=20)),
                ('payload_encrypted', models.TextField(blank=True)),
                ('payload_checksum', models.CharField(blank=True, max_length=64)),
                ('error_message', models.TextField(blank=True)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('requested_by_user_id', models.UUIDField(blank=True, null=True)),
                ('requested_by_facility_code', models.CharField(blank=True, max_length=20)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('patient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='record_exports', to='users.patientprofile')),
            ],
            options={
                'ordering': ['-created_at'],
                'verbose_name': 'Record Export Job',
                'verbose_name_plural': 'Record Export Jobs',
            },
        ),
        migrations.AddIndex(
            model_name='recordexportjob',
            index=models.Index(fields=['patient', 'status'], name='interop_rec_patient_0f4d36_idx'),
        ),
        migrations.AddIndex(
            model_name='recordexportjob',
            index=models.Index(fields=['target_facility_code', 'status'], name='interop_rec_target__8b0a78_idx'),
        ),
        migrations.AddIndex(
            model_name='recordexportjob',
            index=models.Index(fields=['expires_at'], name='interop_rec_expires_e52c14_idx'),
        ),
    ]
