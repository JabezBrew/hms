from django.db import migrations


def backfill_admin_is_staff(apps, schema_editor):
    User = apps.get_model('users', 'User')
    User.objects.filter(user_type='admin', is_staff=False).update(is_staff=True)


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0021_add_trigram_indexes_for_patient_search'),
    ]

    operations = [
        migrations.RunPython(backfill_admin_is_staff, migrations.RunPython.noop),
    ]

