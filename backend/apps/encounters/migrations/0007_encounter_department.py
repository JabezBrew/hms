from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('encounters', '0006_outpatientvisit_triagequeue_and_more'),
        ('organization', '0008_clinicalunit_core_department_clinicschedule'),
    ]

    operations = [
        migrations.AddField(
            model_name='encounter',
            name='department',
            field=models.ForeignKey(
                blank=True,
                help_text='Owning department for this encounter',
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='encounters',
                to='organization.clinicalunit',
            ),
        ),
        migrations.AddIndex(
            model_name='encounter',
            index=models.Index(fields=['department', 'start_time'], name='encounters_departm_66288b_idx'),
        ),
    ]
