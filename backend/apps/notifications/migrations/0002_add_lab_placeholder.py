
from django.db import migrations


def add_lab_placeholder(apps, schema_editor):
    InboxItem = apps.get_model('notifications', 'InboxItem')
    Facility = apps.get_model('core', 'Facility')

    facilities = Facility.objects.all()
    for facility in facilities:
        InboxItem.objects.update_or_create(
            facility=facility,
            recipient_role='lab_technician',
            source_type='lab_result',
            source_id=facility.id,
            dedupe_key=f"lab_placeholder:{facility.id}",
            defaults={
                'recipient_user': None,
                'patient': None,
                'title': 'Lab results workflow coming soon',
                'summary': 'Lab result inbox items will appear here once the lab pipeline is enabled.',
                'action_url': '/laboratory/dashboard',
                'priority': 'routine',
                'status': 'read',
                'is_action_required': False,
                'is_read': True,
                'occurred_at': facility.updated_at,
            }
        )


def remove_lab_placeholder(apps, schema_editor):
    InboxItem = apps.get_model('notifications', 'InboxItem')
    InboxItem.objects.filter(source_type='lab_result', dedupe_key__startswith='lab_placeholder:').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0001_initial'),
        ('core', '0009_facility_status_fields'),
    ]

    operations = [
        migrations.RunPython(add_lab_placeholder, reverse_code=remove_lab_placeholder),
    ]
