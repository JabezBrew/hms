"""
Management command to seed default organization configuration data.

Creates:
- Default UnitTypeConfig entries (facility, department, division, team, specialty)
- Default LeadershipRoleConfig entries (head, deputy, nurse_manager, etc.)
- Default StaffAssignmentTypeConfig entries (single, primary_secondary, rotational)
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.organization.models import (
    UnitTypeConfig,
    LeadershipRoleConfig,
    StaffAssignmentTypeConfig,
)


class Command(BaseCommand):
    help = 'Seed default organization configuration data'

    def add_arguments(self, parser):
        parser.add_argument(
            '--force',
            action='store_true',
            help='Force recreation of all config data (will delete existing)',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        force = options['force']

        if force:
            self.stdout.write('Force mode: Deleting existing configuration...')
            StaffAssignmentTypeConfig.objects.all().delete()
            LeadershipRoleConfig.objects.all().delete()
            UnitTypeConfig.objects.all().delete()

        self._seed_unit_types()
        self._seed_leadership_roles()
        self._seed_assignment_types()

        self.stdout.write(self.style.SUCCESS('Successfully seeded organization configuration'))

    def _seed_unit_types(self):
        """Create default unit type configurations."""
        self.stdout.write('Seeding unit types...')

        unit_types_data = [
            {
                'code': 'facility',
                'name': 'Facility',
                'can_be_root': True,
                'depth_level': 0,
                'can_have_wards': True,
                'can_admit_patients': False,
                'can_consult': False,
                'can_have_budget': True,
                'icon': 'building-2',
                'color': 'slate',
                'display_order': 1,
            },
            {
                'code': 'department',
                'name': 'Department',
                'can_be_root': False,
                'depth_level': 1,
                'can_have_wards': True,
                'can_admit_patients': True,
                'can_consult': True,
                'can_have_budget': True,
                'icon': 'folder',
                'color': 'blue',
                'display_order': 2,
            },
            {
                'code': 'division',
                'name': 'Division',
                'can_be_root': False,
                'depth_level': 2,
                'can_have_wards': True,
                'can_admit_patients': True,
                'can_consult': True,
                'can_have_budget': True,
                'icon': 'git-branch',
                'color': 'indigo',
                'display_order': 3,
            },
            {
                'code': 'team',
                'name': 'Team',
                'can_be_root': False,
                'depth_level': 3,
                'can_have_wards': True,
                'can_admit_patients': True,
                'can_consult': True,
                'can_have_budget': False,
                'icon': 'users',
                'color': 'emerald',
                'display_order': 4,
            },
            {
                'code': 'specialty',
                'name': 'Specialty',
                'can_be_root': False,
                'depth_level': 2,
                'can_have_wards': False,
                'can_admit_patients': True,
                'can_consult': True,
                'can_have_budget': False,
                'icon': 'stethoscope',
                'color': 'amber',
                'display_order': 5,
            },
            {
                'code': 'service',
                'name': 'Service',
                'can_be_root': False,
                'depth_level': 3,
                'can_have_wards': False,
                'can_admit_patients': True,
                'can_consult': True,
                'can_have_budget': False,
                'icon': 'heart-pulse',
                'color': 'rose',
                'display_order': 6,
            },
        ]

        created_types = {}
        for data in unit_types_data:
            unit_type, created = UnitTypeConfig.objects.get_or_create(
                code=data['code'],
                defaults=data
            )
            created_types[data['code']] = unit_type
            if created:
                self.stdout.write(f'  Created unit type: {data["name"]}')
            else:
                self.stdout.write(f'  Unit type already exists: {data["name"]}')

        # Set up parent type relationships
        # Facility can only be root (no parents)
        # Department can be under Facility
        created_types['department'].allowed_parent_types.add(created_types['facility'])
        # Division can be under Department or Facility
        created_types['division'].allowed_parent_types.add(
            created_types['department'],
            created_types['facility']
        )
        # Team can be under Division, Department, or Specialty
        created_types['team'].allowed_parent_types.add(
            created_types['division'],
            created_types['department'],
            created_types['specialty']
        )
        # Specialty can be under Department or Division
        created_types['specialty'].allowed_parent_types.add(
            created_types['department'],
            created_types['division']
        )
        # Service can be under Department, Division, or Specialty
        created_types['service'].allowed_parent_types.add(
            created_types['department'],
            created_types['division'],
            created_types['specialty']
        )

        self.stdout.write(f'  Configured parent type relationships')

    def _seed_leadership_roles(self):
        """Create default leadership role configurations."""
        self.stdout.write('Seeding leadership roles...')

        roles_data = [
            {
                'code': 'head',
                'name': 'Head',
                'is_primary_leader': True,
                'max_per_unit': 1,
                'can_approve': True,
                'can_manage_staff': True,
                'can_manage_budget': True,
                'can_view_all_data': True,
                'display_order': 1,
            },
            {
                'code': 'deputy',
                'name': 'Deputy Head',
                'is_primary_leader': False,
                'max_per_unit': 2,
                'can_approve': True,
                'can_manage_staff': True,
                'can_manage_budget': False,
                'can_view_all_data': True,
                'display_order': 2,
            },
            {
                'code': 'medical_director',
                'name': 'Medical Director',
                'is_primary_leader': True,
                'max_per_unit': 1,
                'can_approve': True,
                'can_manage_staff': True,
                'can_manage_budget': True,
                'can_view_all_data': True,
                'display_order': 3,
            },
            {
                'code': 'nurse_manager',
                'name': 'Nurse Manager',
                'is_primary_leader': False,
                'max_per_unit': 1,
                'can_approve': True,
                'can_manage_staff': True,
                'can_manage_budget': False,
                'can_view_all_data': True,
                'display_order': 4,
            },
            {
                'code': 'charge_nurse',
                'name': 'Charge Nurse',
                'is_primary_leader': False,
                'max_per_unit': 3,
                'can_approve': False,
                'can_manage_staff': False,
                'can_manage_budget': False,
                'can_view_all_data': True,
                'display_order': 5,
            },
            {
                'code': 'team_lead',
                'name': 'Team Lead',
                'is_primary_leader': False,
                'max_per_unit': 2,
                'can_approve': False,
                'can_manage_staff': False,
                'can_manage_budget': False,
                'can_view_all_data': True,
                'display_order': 6,
            },
            {
                'code': 'attending',
                'name': 'Attending Physician',
                'is_primary_leader': False,
                'max_per_unit': 10,
                'can_approve': False,
                'can_manage_staff': False,
                'can_manage_budget': False,
                'can_view_all_data': True,
                'display_order': 7,
            },
        ]

        for data in roles_data:
            role, created = LeadershipRoleConfig.objects.get_or_create(
                code=data['code'],
                defaults=data
            )
            if created:
                self.stdout.write(f'  Created leadership role: {data["name"]}')
                # Add applicable unit types (all types except facility for most roles)
                unit_types = UnitTypeConfig.objects.filter(is_active=True)
                if data['code'] in ['head', 'deputy', 'medical_director']:
                    # These apply to all unit types
                    role.applicable_unit_types.set(unit_types)
                elif data['code'] in ['nurse_manager', 'charge_nurse']:
                    # These typically apply to wards/units with clinical staff
                    role.applicable_unit_types.set(
                        unit_types.filter(code__in=['department', 'division', 'team'])
                    )
                else:
                    # Other roles apply to teams and services
                    role.applicable_unit_types.set(
                        unit_types.filter(code__in=['team', 'service', 'specialty'])
                    )
            else:
                self.stdout.write(f'  Leadership role already exists: {data["name"]}')

    def _seed_assignment_types(self):
        """Create default staff assignment type configurations."""
        self.stdout.write('Seeding staff assignment types...')

        assignment_types_data = [
            {
                'code': 'single',
                'name': 'Single Assignment',
                'requires_primary': False,
                'allows_secondary': False,
                'allows_multiple_primary': False,
                'supports_date_ranges': False,
                'applicable_user_types': ['nurse', 'allied_health'],
            },
            {
                'code': 'primary_secondary',
                'name': 'Primary/Secondary Assignment',
                'requires_primary': True,
                'allows_secondary': True,
                'allows_multiple_primary': False,
                'supports_date_ranges': False,
                'applicable_user_types': ['doctor', 'nurse'],
            },
            {
                'code': 'rotational',
                'name': 'Rotational Assignment',
                'requires_primary': False,
                'allows_secondary': False,
                'allows_multiple_primary': True,
                'supports_date_ranges': True,
                'applicable_user_types': ['doctor', 'resident', 'fellow'],
            },
            {
                'code': 'consulting',
                'name': 'Consulting Assignment',
                'requires_primary': False,
                'allows_secondary': False,
                'allows_multiple_primary': True,
                'supports_date_ranges': True,
                'applicable_user_types': ['doctor'],
            },
        ]

        for data in assignment_types_data:
            _, created = StaffAssignmentTypeConfig.objects.get_or_create(
                code=data['code'],
                defaults=data
            )
            if created:
                self.stdout.write(f'  Created assignment type: {data["name"]}')
            else:
                self.stdout.write(f'  Assignment type already exists: {data["name"]}')
