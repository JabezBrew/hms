from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0010_user_name_trgm_indexes'),
    ]

    operations = [
        migrations.AddField(
            model_name='patientprofile',
            name='patient_identity_id',
            field=models.UUIDField(blank=True, null=True, db_index=True, help_text='MPI patient identity ID (control-plane reference)'),
        ),
    ]
