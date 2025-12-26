# Migration to fix Ward hierarchy: Ward should belong to Department, not Facility
# Hierarchy: Facility → Department → Ward

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0005_multi_facility_foundation'),
        ('wards', '0011_multi_facility_foundation'),
    ]

    operations = [
        # Remove the incorrect facility FK
        migrations.RemoveField(
            model_name='ward',
            name='facility',
        ),
        # Add the correct department FK
        migrations.AddField(
            model_name='ward',
            name='department',
            field=models.ForeignKey(
                blank=True,
                help_text='The department this ward belongs to',
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='wards',
                to='core.department'
            ),
        ),
    ]
