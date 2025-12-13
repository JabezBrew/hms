# Generated migration for search optimization
from django.db import migrations
from django.contrib.postgres.operations import TrigramExtension
from django.contrib.postgres.indexes import GinIndex


class Migration(migrations.Migration):
    """
    Add GIN trigram indexes for efficient text search on User first_name/last_name.
    This dramatically improves icontains queries used in patient search.
    """

    dependencies = [
        ('users', '0006_add_user_patient_list'),
    ]

    operations = [
        # Enable pg_trgm extension (required for GIN trigram indexes)
        TrigramExtension(),

        # Add GIN trigram index on User.first_name for fast text search
        migrations.AddIndex(
            model_name='user',
            index=GinIndex(
                name='user_first_name_gin_idx',
                fields=['first_name'],
                opclasses=['gin_trgm_ops'],
            ),
        ),

        # Add GIN trigram index on User.last_name for fast text search
        migrations.AddIndex(
            model_name='user',
            index=GinIndex(
                name='user_last_name_gin_idx',
                fields=['last_name'],
                opclasses=['gin_trgm_ops'],
            ),
        ),
    ]
