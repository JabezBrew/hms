from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('organization', '0009_add_primary_team_and_care_teams'),
    ]

    operations = [
        migrations.AddField(
            model_name='clinicalunit',
            name='ward_assignment_policy',
            field=models.CharField(
                choices=[
                    ('flexible', 'Flexible - Patient stays with admitting team'),
                    ('strict', 'Strict - Patient transfers to ward\'s team'),
                ],
                default='flexible',
                help_text='Policy when patient is placed in a ward owned by another team',
                max_length=20,
            ),
        ),
        migrations.AddIndex(
            model_name='clinicalunit',
            index=models.Index(fields=['ward_assignment_policy', 'is_active'], name='organizatio_ward_p_a26a4c_idx'),
        ),
        migrations.AddIndex(
            model_name='dutyroster',
            index=models.Index(
                fields=[
                    'unit',
                    'date',
                    'role',
                    'context',
                    'is_primary',
                    'is_active',
                    'start_time',
                    'end_time',
                ],
                name='organizatio_dutyroster_on_40ea2a_idx',
            ),
        ),
    ]
