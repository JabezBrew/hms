"""
Migration to make encounter field required on NoteEntry and Prescription.

IMPORTANT: Before running this migration, you MUST run the backfill command:
    python manage.py backfill_encounters --apply

This migration will fail if there are any entries with null encounter values.
"""
from django.db import migrations, models
from django.db.utils import ProgrammingError
import django.db.models.deletion


def check_no_null_encounters(apps, schema_editor):
    """Verify no null encounters exist before making field required."""
    NoteEntry = apps.get_model('clinical_notes', 'NoteEntry')
    Prescription = apps.get_model('clinical_notes', 'Prescription')

    try:
        null_notes = NoteEntry.objects.filter(encounter__isnull=True).count()
        null_prescriptions = Prescription.objects.filter(encounter__isnull=True).count()
    except ProgrammingError:
        # Table doesn't exist yet (fresh database) - no data to check
        return

    if null_notes > 0 or null_prescriptions > 0:
        raise ValueError(
            f"Cannot make encounter required: {null_notes} notes and {null_prescriptions} "
            f"prescriptions have null encounters. Run 'python manage.py backfill_encounters --apply' first."
        )


def reverse_noop(apps, schema_editor):
    """No-op for reverse migration."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('wards', '0005_add_local_encounter_model'),
        ('encounters', '0001_initial'),
        ('clinical_notes', '0004_link_encounter_to_chronicles'),
    ]

    operations = [
        # First, verify no null encounters exist
        migrations.RunPython(check_no_null_encounters, reverse_noop),

        # Then alter the NoteEntry.encounter field to be required
        migrations.AlterField(
            model_name='noteentry',
            name='encounter',
            field=models.ForeignKey(
                help_text='The clinical encounter/visit during which this note was created',
                on_delete=django.db.models.deletion.PROTECT,
                related_name='note_entries',
                to='encounters.Encounter',
            ),
        ),

        # And alter the Prescription.encounter field to be required
        migrations.AlterField(
            model_name='prescription',
            name='encounter',
            field=models.ForeignKey(
                help_text='The clinical encounter/visit during which this was prescribed',
                on_delete=django.db.models.deletion.PROTECT,
                related_name='prescriptions',
                to='encounters.Encounter',
            ),
        ),
    ]
