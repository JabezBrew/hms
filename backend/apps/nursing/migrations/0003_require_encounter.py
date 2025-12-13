"""
Migration to make encounter field required on VitalSigns.

IMPORTANT: Before running this migration, you MUST run the backfill command:
    python manage.py backfill_encounters --apply

This migration will fail if there are any vital signs with null encounter values.
"""
from django.db import migrations, models
from django.db.utils import ProgrammingError
import django.db.models.deletion


def check_no_null_encounters(apps, schema_editor):
    """Verify no null encounters exist before making field required."""
    VitalSigns = apps.get_model('nursing', 'VitalSigns')

    try:
        null_vitals = VitalSigns.objects.filter(encounter__isnull=True).count()
    except ProgrammingError:
        # Table doesn't exist yet (fresh database) - no data to check
        return

    if null_vitals > 0:
        raise ValueError(
            f"Cannot make encounter required: {null_vitals} vital signs records have null "
            f"encounters. Run 'python manage.py backfill_encounters --apply' first."
        )


def reverse_noop(apps, schema_editor):
    """No-op for reverse migration."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('wards', '0005_add_local_encounter_model'),
        ('nursing', '0002_link_encounter_to_chronicles'),
    ]

    operations = [
        # First, verify no null encounters exist
        migrations.RunPython(check_no_null_encounters, reverse_noop),

        # Then alter the VitalSigns.encounter field to be required
        migrations.AlterField(
            model_name='vitalsigns',
            name='encounter',
            field=models.ForeignKey(
                help_text='The clinical encounter/visit during which these vitals were recorded',
                on_delete=django.db.models.deletion.PROTECT,
                related_name='vital_signs',
                to='wards.encounter',
            ),
        ),
    ]
