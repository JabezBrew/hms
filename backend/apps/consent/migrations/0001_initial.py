from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ('mpi', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='ConsentGrant',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('source_facility_code', models.CharField(max_length=20)),
                ('target_facility_code', models.CharField(max_length=20)),
                ('scope', models.CharField(choices=[('full_record', 'Full Record')], max_length=50)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('active', 'Active'), ('revoked', 'Revoked'), ('expired', 'Expired')], default='pending', max_length=20)),
                ('reason', models.CharField(blank=True, max_length=200)),
                ('granted_at', models.DateTimeField(blank=True, null=True)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                ('created_by_facility_code', models.CharField(blank=True, max_length=20)),
                ('created_by_user_id', models.UUIDField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('patient_identity', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='consent_grants', to='mpi.patientidentity')),
            ],
            options={
                'ordering': ['-created_at'],
                'verbose_name': 'Consent Grant',
                'verbose_name_plural': 'Consent Grants',
            },
        ),
        migrations.CreateModel(
            name='CrossFacilityReferral',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('source_facility_code', models.CharField(max_length=20)),
                ('target_facility_code', models.CharField(max_length=20)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('accepted', 'Accepted'), ('declined', 'Declined'), ('cancelled', 'Cancelled')], default='pending', max_length=20)),
                ('reason_code', models.CharField(blank=True, max_length=100)),
                ('created_by_facility_code', models.CharField(blank=True, max_length=20)),
                ('created_by_user_id', models.UUIDField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('responded_at', models.DateTimeField(blank=True, null=True)),
                ('decline_reason', models.CharField(blank=True, max_length=200)),
                ('patient_identity', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='referrals', to='mpi.patientidentity')),
            ],
            options={
                'ordering': ['-created_at'],
                'verbose_name': 'Cross-Facility Referral',
                'verbose_name_plural': 'Cross-Facility Referrals',
            },
        ),
        migrations.CreateModel(
            name='ConsentAccessToken',
            fields=[
                ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ('token_hash', models.CharField(db_index=True, max_length=64)),
                ('target_facility_code', models.CharField(max_length=20)),
                ('expires_at', models.DateTimeField()),
                ('last_used_at', models.DateTimeField(blank=True, null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('consent_grant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='access_tokens', to='consent.consentgrant')),
            ],
            options={
                'ordering': ['-created_at'],
                'verbose_name': 'Consent Access Token',
                'verbose_name_plural': 'Consent Access Tokens',
            },
        ),
        migrations.AddIndex(
            model_name='consentgrant',
            index=models.Index(fields=['patient_identity', 'status'], name='consent_con_patient_50c2b2_idx'),
        ),
        migrations.AddIndex(
            model_name='consentgrant',
            index=models.Index(fields=['source_facility_code', 'target_facility_code'], name='consent_con_source__c5e98c_idx'),
        ),
        migrations.AddIndex(
            model_name='consentgrant',
            index=models.Index(fields=['expires_at'], name='consent_con_expires_5b2b2a_idx'),
        ),
        migrations.AddIndex(
            model_name='crossfacilityreferral',
            index=models.Index(fields=['patient_identity', 'status'], name='consent_cro_patient_7fe5f8_idx'),
        ),
        migrations.AddIndex(
            model_name='crossfacilityreferral',
            index=models.Index(fields=['source_facility_code', 'target_facility_code'], name='consent_cro_source__2f1121_idx'),
        ),
        migrations.AddIndex(
            model_name='consentaccesstoken',
            index=models.Index(fields=['target_facility_code', 'expires_at'], name='consent_con_target__ab2b6d_idx'),
        ),
    ]
