from django.db import migrations, models


def set_note_template_facility(apps, schema_editor):
    Facility = apps.get_model('core', 'Facility')
    NoteTemplate = apps.get_model('clinical_notes', 'NoteTemplate')

    facility = Facility.objects.order_by('created_at').first()
    if not facility:
        return

    NoteTemplate.objects.filter(facility__isnull=True).update(facility=facility)


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0009_facility_status_fields'),
        ('clinical_notes', '0012_rename_clinical_notes_facility_created_idx_clinical_no_facilit_1d458d_idx_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='notetemplate',
            name='facility',
            field=models.ForeignKey(null=True, on_delete=models.PROTECT, related_name='note_templates', to='core.facility'),
        ),
        migrations.RunPython(set_note_template_facility, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='notetemplate',
            name='facility',
            field=models.ForeignKey(on_delete=models.PROTECT, related_name='note_templates', to='core.facility'),
        ),
        migrations.AddIndex(
            model_name='notetemplate',
            index=models.Index(fields=['facility', 'visibility'], name='clinical_n_facility_visibility_idx'),
        ),
    ]
