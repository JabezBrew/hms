from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0023_remove_patientprofile_users_patient_mrn_trgm_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='must_change_password',
            field=models.BooleanField(
                default=False,
                help_text='Require user to change password before full access.',
            ),
        ),
        migrations.AddField(
            model_name='user',
            name='password_changed_at',
            field=models.DateTimeField(
                blank=True,
                help_text='Timestamp of the last completed password change.',
                null=True,
            ),
        ),
    ]
