"""
Helpers for seeding facility-scoped system chart templates.
"""

from apps.charts.models import ChartTemplate, ChartField
from apps.charts.system_templates import SYSTEM_TEMPLATE_DEFINITIONS


def ensure_system_templates_for_facility(facility):
    if not facility:
        return []

    created_templates = []
    for definition in SYSTEM_TEMPLATE_DEFINITIONS:
        template, created = ChartTemplate.objects.get_or_create(
            facility=facility,
            system_key=definition['system_key'],
            defaults={
                'name': definition['name'],
                'description': definition.get('description', ''),
                'icon': definition.get('icon', 'clipboard-list'),
                'visibility': 'facility',
                'category': definition['category'],
                'scope_type': definition['scope_type'],
                'default_interval': definition['default_interval'],
                'display_mode': definition.get('display_mode', 'table'),
                'is_active': True,
                'is_system': True,
            },
        )

        changed = created
        if not created:
            for field_name in ['name', 'description', 'icon', 'category', 'scope_type', 'default_interval', 'display_mode']:
                next_value = definition.get(field_name)
                if next_value is not None and getattr(template, field_name) != next_value:
                    setattr(template, field_name, next_value)
                    changed = True
            if not template.is_system:
                template.is_system = True
                changed = True
            if not template.is_active:
                template.is_active = True
                changed = True
            if changed:
                template.save()

        for field_definition in definition.get('fields', []):
            ChartField.objects.update_or_create(
                template=template,
                field_key=field_definition['field_key'],
                defaults={
                    'name': field_definition['name'],
                    'field_type': field_definition['field_type'],
                    'display_order': field_definition.get('display_order', 0),
                    'group_name': field_definition.get('group_name', ''),
                    'help_text': field_definition.get('help_text', ''),
                    'icon': field_definition.get('icon', ''),
                    'is_required': field_definition.get('is_required', False),
                    'config': field_definition.get('config', {}),
                    'show_when': field_definition.get('show_when'),
                },
            )

        if created:
            created_templates.append(template)

    return created_templates
