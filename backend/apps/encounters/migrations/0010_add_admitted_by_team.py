from django.db import migrations, models
import django.db.models.deletion


def backfill_admitted_by_team(apps, schema_editor):
    Encounter = apps.get_model('encounters', 'Encounter')
    Encounter.objects.filter(admitted_by_team__isnull=True, primary_team__isnull=False).update(
        admitted_by_team=models.F('primary_team')
    )


class Migration(migrations.Migration):

    dependencies = [
        ('organization', '0009_add_primary_team_and_care_teams'),
        ('encounters', '0009_migrate_care_teams_to_encounter'),
    ]

    operations = [
        migrations.AddField(
            model_name='encounter',
            name='admitted_by_team',
            field=models.ForeignKey(
                blank=True,
                help_text='Team that originally admitted the patient',
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='admitted_encounters',
                to='organization.clinicalunit',
            ),
        ),
        migrations.RunPython(backfill_admitted_by_team, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name='encounter',
            index=models.Index(fields=['admitted_by_team', 'status'], name='wards_encou_admitted_2d3a66_idx'),
        ),
    ]
