from django.contrib.postgres.indexes import GinIndex
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0006_enable_pg_trgm'),
        ('laboratory', '0010_labtestcatalog_billing_service'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='laborder',
            index=GinIndex(
                fields=['order_number'],
                name='lab_order_number_trgm',
                opclasses=['gin_trgm_ops'],
            ),
        ),
        migrations.AddIndex(
            model_name='labtestcatalog',
            index=GinIndex(
                fields=['name'],
                name='lab_test_name_trgm',
                opclasses=['gin_trgm_ops'],
            ),
        ),
        migrations.AddIndex(
            model_name='labtestcatalog',
            index=GinIndex(
                fields=['short_name'],
                name='lab_test_short_name_trgm',
                opclasses=['gin_trgm_ops'],
            ),
        ),
        migrations.AddIndex(
            model_name='labtestcatalog',
            index=GinIndex(
                fields=['code'],
                name='lab_test_code_trgm',
                opclasses=['gin_trgm_ops'],
            ),
        ),
    ]
