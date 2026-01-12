import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0011_patient_identity_id'),
    ]

    operations = [
        migrations.CreateModel(
            name='UserMFAProfile',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('totp_secret_encrypted', models.CharField(blank=True, max_length=255)),
                ('totp_confirmed_at', models.DateTimeField(blank=True, null=True)),
                ('totp_last_used_at', models.DateTimeField(blank=True, null=True)),
                ('recovery_codes', models.JSONField(blank=True, default=list)),
                ('recovery_codes_generated_at', models.DateTimeField(blank=True, null=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(on_delete=models.deletion.CASCADE, related_name='mfa_profile', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'User MFA Profile',
                'verbose_name_plural': 'User MFA Profiles',
            },
        ),
        migrations.CreateModel(
            name='WebAuthnCredential',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('credential_id', models.CharField(max_length=255, unique=True)),
                ('public_key', models.TextField()),
                ('sign_count', models.PositiveIntegerField(default=0)),
                ('transports', models.JSONField(blank=True, default=list)),
                ('name', models.CharField(blank=True, max_length=100)),
                ('is_resident_key', models.BooleanField(default=False)),
                ('is_active', models.BooleanField(default=True)),
                ('last_used_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='webauthn_credentials', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'WebAuthn Credential',
                'verbose_name_plural': 'WebAuthn Credentials',
            },
        ),
        migrations.CreateModel(
            name='MFASession',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('token_hash', models.CharField(max_length=64, unique=True)),
                ('purpose', models.CharField(choices=[('login', 'Login'), ('enrollment', 'Enrollment')], default='login', max_length=20)),
                ('facility_code', models.CharField(blank=True, max_length=20)),
                ('enrollment_required', models.BooleanField(default=False)),
                ('totp_verified', models.BooleanField(default=False)),
                ('webauthn_verified', models.BooleanField(default=False)),
                ('webauthn_challenge', models.CharField(blank=True, max_length=255)),
                ('webauthn_challenge_expires_at', models.DateTimeField(blank=True, null=True)),
                ('webauthn_challenge_type', models.CharField(blank=True, max_length=20)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField()),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('user', models.ForeignKey(on_delete=models.deletion.CASCADE, related_name='mfa_sessions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'MFA Session',
                'verbose_name_plural': 'MFA Sessions',
            },
        ),
        migrations.AddIndex(
            model_name='usermfaprofile',
            index=models.Index(fields=['user'], name='users_userm_user_id_88c74a_idx'),
        ),
        migrations.AddIndex(
            model_name='webauthncredential',
            index=models.Index(fields=['user', 'is_active'], name='users_webauth_user_id_3c7d0a_idx'),
        ),
        migrations.AddIndex(
            model_name='mfasession',
            index=models.Index(fields=['token_hash'], name='users_mfasess_token_h_6202b6_idx'),
        ),
        migrations.AddIndex(
            model_name='mfasession',
            index=models.Index(fields=['user', 'expires_at'], name='users_mfasess_user_id_0b2b2b_idx'),
        ),
    ]
