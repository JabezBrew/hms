# Migration to remove Encounter model from wards app state
# The model is now managed by the encounters app

from django.db import migrations


class Migration(migrations.Migration):
    """
    This migration removes the Encounter model from wards app's state.

    The model has been moved to the encounters app. This migration:
    1. Removes Encounter from wards app state (state_operations)
    2. Does not touch the database (no database_operations)
    """

    dependencies = [
        ('wards', '0012_fix_ward_department_hierarchy'),
        ('encounters', '0001_initial'),  # Ensure encounters app has the model first
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.DeleteModel(
                    name='Encounter',
                ),
            ],
            database_operations=[],  # No database operations - table stays
        ),
    ]
