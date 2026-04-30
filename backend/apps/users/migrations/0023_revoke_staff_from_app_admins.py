from django.db import migrations


def revoke_staff_from_non_superuser_admins(apps, schema_editor):
    User = apps.get_model('users', 'User')
    User.objects.filter(user_type='admin', is_superuser=False, is_staff=True).update(is_staff=False)


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0022_backfill_admin_is_staff'),
    ]

    operations = [
        migrations.RunPython(revoke_staff_from_non_superuser_admins, migrations.RunPython.noop),
    ]
