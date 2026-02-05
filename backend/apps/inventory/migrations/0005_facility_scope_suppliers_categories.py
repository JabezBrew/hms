from django.db import migrations, models


def set_inventory_facility(apps, schema_editor):
    Facility = apps.get_model('core', 'Facility')
    InventoryCategory = apps.get_model('inventory', 'InventoryCategory')
    Supplier = apps.get_model('inventory', 'Supplier')

    facility = Facility.objects.order_by('created_at').first()
    if not facility:
        return

    InventoryCategory.objects.filter(facility__isnull=True).update(facility=facility)
    Supplier.objects.filter(facility__isnull=True).update(facility=facility)


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0009_facility_status_fields'),
        ('inventory', '0004_rename_inventory_stock_facility_ts_idx_inventory_s_facilit_ac20b0_idx_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='inventorycategory',
            name='facility',
            field=models.ForeignKey(null=True, on_delete=models.PROTECT, related_name='inventory_categories', to='core.facility'),
        ),
        migrations.AddField(
            model_name='supplier',
            name='facility',
            field=models.ForeignKey(null=True, on_delete=models.PROTECT, related_name='suppliers', to='core.facility'),
        ),
        migrations.RunPython(set_inventory_facility, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='inventorycategory',
            name='facility',
            field=models.ForeignKey(on_delete=models.PROTECT, related_name='inventory_categories', to='core.facility'),
        ),
        migrations.AlterField(
            model_name='supplier',
            name='facility',
            field=models.ForeignKey(on_delete=models.PROTECT, related_name='suppliers', to='core.facility'),
        ),
        migrations.AddIndex(
            model_name='inventorycategory',
            index=models.Index(fields=['facility', 'name'], name='inventory_cat_facility_name_idx'),
        ),
        migrations.AddIndex(
            model_name='supplier',
            index=models.Index(fields=['facility', 'name'], name='inventory_supplier_facility_name_idx'),
        ),
    ]
