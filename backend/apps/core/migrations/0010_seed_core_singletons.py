from django.db import migrations


def seed_core_singletons(apps, schema_editor):
    OffSiteAccessSettings = apps.get_model('core', 'OffSiteAccessSettings')
    if not OffSiteAccessSettings.objects.exists():
        OffSiteAccessSettings.objects.create(pk=1)

    FacilityFluidBalanceSettings = apps.get_model('core', 'FacilityFluidBalanceSettings')
    if not FacilityFluidBalanceSettings.objects.exists():
        FacilityFluidBalanceSettings.objects.create(pk=1)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0009_facility_status_fields'),
    ]

    operations = [
        migrations.RunPython(seed_core_singletons, noop),
    ]
