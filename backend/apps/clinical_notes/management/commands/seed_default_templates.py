"""
Management command to seed default system note templates.

Run with: python manage.py seed_default_templates

These templates are system-level defaults that are always available to all users.
They have created_by=None and visibility='public'.
"""

from django.core.management.base import BaseCommand
from apps.clinical_notes.models import NoteTemplate


# Default system templates with their structures
DEFAULT_TEMPLATES = [
    {
        'title': 'SOAP Note',
        'description': 'Standard Subjective, Objective, Assessment, Plan documentation format',
        'category': 'soap',
        'icon': 'clipboard-list',
        'estimated_steps': 4,
        'structure': {
            'sections': [
                {
                    'name': 'Subjective',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Chief Complaint', 'type': 'text', 'required': True},
                        {'name': 'History of Present Illness', 'type': 'text', 'required': True},
                        {'name': 'Review of Systems', 'type': 'text', 'required': False},
                        {'name': 'Current Medications', 'type': 'text', 'required': False},
                        {'name': 'Allergies', 'type': 'text', 'required': False},
                        {'name': 'Social History', 'type': 'text', 'required': False},
                        {'name': 'Family History', 'type': 'text', 'required': False},
                    ]
                },
                {
                    'name': 'Objective',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Vital Signs', 'type': 'observation', 'observationType': 'vitals'},
                        {'name': 'Physical Exam', 'type': 'text', 'required': True},
                        {'name': 'Investigations', 'type': 'text', 'required': False},
                    ]
                },
                {
                    'name': 'Assessment',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Primary Diagnosis', 'type': 'text', 'required': True},
                        {'name': 'Differential Diagnoses', 'type': 'text', 'required': False},
                        {'name': 'Clinical Reasoning', 'type': 'text', 'required': False},
                    ]
                },
                {
                    'name': 'Plan',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Medications', 'type': 'text', 'required': False},
                        {'name': 'Investigations', 'type': 'text', 'required': False},
                        {'name': 'Non-Pharmacological', 'type': 'text', 'required': False},
                        {'name': 'Patient Education', 'type': 'text', 'required': False},
                        {'name': 'Follow Up', 'type': 'text', 'required': False},
                        {'name': 'Referrals', 'type': 'text', 'required': False},
                    ]
                },
            ]
        }
    },
    {
        'title': 'Progress Note',
        'description': 'General progress note for ongoing patient care',
        'category': 'progress',
        'icon': 'file-text',
        'estimated_steps': 3,
        'structure': {
            'sections': [
                {
                    'name': 'Interval History',
                    'type': 'text',
                    'required': True,
                    'helpText': 'Document changes since last visit'
                },
                {
                    'name': 'Current Status',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Vital Signs', 'type': 'observation', 'observationType': 'vitals'},
                        {'name': 'Physical Findings', 'type': 'text'},
                        {'name': 'Lab Results', 'type': 'text'},
                    ]
                },
                {
                    'name': 'Plan',
                    'type': 'text',
                    'required': True,
                    'helpText': 'Document treatment adjustments and next steps'
                },
            ]
        }
    },
    {
        'title': 'Procedure Note',
        'description': 'Documentation for clinical procedures',
        'category': 'procedure',
        'icon': 'activity',
        'estimated_steps': 3,
        'structure': {
            'sections': [
                {
                    'name': 'Pre-Procedure',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Indication', 'type': 'text', 'required': True},
                        {'name': 'Consent', 'type': 'text', 'required': True},
                        {'name': 'Pre-Procedure Checklist', 'type': 'text'},
                    ]
                },
                {
                    'name': 'Procedure Details',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Procedure Performed', 'type': 'text', 'required': True},
                        {'name': 'Technique', 'type': 'text'},
                        {'name': 'Findings', 'type': 'text'},
                        {'name': 'Specimens', 'type': 'text'},
                        {'name': 'Complications', 'type': 'text'},
                    ]
                },
                {
                    'name': 'Post-Procedure',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Patient Condition', 'type': 'text'},
                        {'name': 'Instructions', 'type': 'text'},
                        {'name': 'Follow Up', 'type': 'text'},
                    ]
                },
            ]
        }
    },
    {
        'title': 'Admission Note',
        'description': 'Initial documentation when admitting a patient',
        'category': 'admission',
        'icon': 'user-plus',
        'estimated_steps': 4,
        'structure': {
            'sections': [
                {
                    'name': 'Admission Information',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Reason for Admission', 'type': 'text', 'required': True},
                        {'name': 'Admitting Diagnosis', 'type': 'text', 'required': True},
                        {'name': 'Source of Admission', 'type': 'text'},
                    ]
                },
                {
                    'name': 'History',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'History of Present Illness', 'type': 'text', 'required': True},
                        {'name': 'Past Medical History', 'type': 'text'},
                        {'name': 'Surgical History', 'type': 'text'},
                        {'name': 'Medications', 'type': 'text'},
                        {'name': 'Allergies', 'type': 'text'},
                        {'name': 'Social History', 'type': 'text'},
                        {'name': 'Family History', 'type': 'text'},
                    ]
                },
                {
                    'name': 'Examination',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Vital Signs', 'type': 'observation', 'observationType': 'vitals'},
                        {'name': 'General Examination', 'type': 'text'},
                        {'name': 'System Examination', 'type': 'text'},
                    ]
                },
                {
                    'name': 'Initial Plan',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Investigations', 'type': 'text'},
                        {'name': 'Treatment Plan', 'type': 'text'},
                        {'name': 'Consultations', 'type': 'text'},
                        {'name': 'Diet', 'type': 'text'},
                        {'name': 'Activity', 'type': 'text'},
                    ]
                },
            ]
        }
    },
    {
        'title': 'Discharge Summary',
        'description': 'Summary documentation when discharging a patient',
        'category': 'discharge',
        'icon': 'log-out',
        'estimated_steps': 3,
        'structure': {
            'sections': [
                {
                    'name': 'Admission Summary',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Admission Date', 'type': 'text'},
                        {'name': 'Discharge Date', 'type': 'text'},
                        {'name': 'Admission Diagnosis', 'type': 'text'},
                        {'name': 'Discharge Diagnosis', 'type': 'text', 'required': True},
                    ]
                },
                {
                    'name': 'Hospital Course',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Brief Summary', 'type': 'text', 'required': True},
                        {'name': 'Procedures Performed', 'type': 'text'},
                        {'name': 'Significant Findings', 'type': 'text'},
                        {'name': 'Complications', 'type': 'text'},
                    ]
                },
                {
                    'name': 'Discharge Plan',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Discharge Medications', 'type': 'text', 'required': True},
                        {'name': 'Discharge Instructions', 'type': 'text', 'required': True},
                        {'name': 'Follow Up Appointments', 'type': 'text'},
                        {'name': 'Warning Signs', 'type': 'text'},
                        {'name': 'Diet and Activity', 'type': 'text'},
                    ]
                },
            ]
        }
    },
    {
        'title': 'Nursing Assessment',
        'description': 'Comprehensive nursing assessment documentation',
        'category': 'nursing',
        'icon': 'heart-pulse',
        'estimated_steps': 3,
        'structure': {
            'sections': [
                {
                    'name': 'Vital Signs',
                    'type': 'observation',
                    'observationType': 'vitals',
                    'required': True,
                },
                {
                    'name': 'Assessment',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Level of Consciousness', 'type': 'text'},
                        {'name': 'Pain Assessment', 'type': 'text'},
                        {'name': 'Skin Assessment', 'type': 'text'},
                        {'name': 'Respiratory Assessment', 'type': 'text'},
                        {'name': 'Cardiovascular Assessment', 'type': 'text'},
                        {'name': 'GI Assessment', 'type': 'text'},
                        {'name': 'GU Assessment', 'type': 'text'},
                        {'name': 'Mobility Assessment', 'type': 'text'},
                    ]
                },
                {
                    'name': 'Care Plan',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Nursing Diagnoses', 'type': 'text'},
                        {'name': 'Interventions', 'type': 'text'},
                        {'name': 'Patient Education', 'type': 'text'},
                    ]
                },
            ]
        }
    },
    {
        'title': 'Consultation Note',
        'description': 'Documentation for specialist consultations',
        'category': 'consultation',
        'icon': 'stethoscope',
        'estimated_steps': 3,
        'structure': {
            'sections': [
                {
                    'name': 'Consultation Request',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Reason for Consultation', 'type': 'text', 'required': True},
                        {'name': 'Referring Physician', 'type': 'text'},
                        {'name': 'Urgency', 'type': 'text'},
                    ]
                },
                {
                    'name': 'Consultant Evaluation',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'History Review', 'type': 'text'},
                        {'name': 'Examination Findings', 'type': 'text'},
                        {'name': 'Review of Investigations', 'type': 'text'},
                    ]
                },
                {
                    'name': 'Recommendations',
                    'type': 'structured',
                    'required': True,
                    'subsections': [
                        {'name': 'Assessment', 'type': 'text', 'required': True},
                        {'name': 'Recommendations', 'type': 'text', 'required': True},
                        {'name': 'Follow Up', 'type': 'text'},
                    ]
                },
            ]
        }
    },
]


class Command(BaseCommand):
    help = 'Seed default system note templates'

    def add_arguments(self, parser):
        parser.add_argument(
            '--force',
            action='store_true',
            help='Update existing templates instead of skipping them',
        )

    def handle(self, *args, **options):
        force = options['force']
        created_count = 0
        updated_count = 0
        skipped_count = 0

        self.stdout.write(self.style.MIGRATE_HEADING('Seeding default note templates...'))

        for template_data in DEFAULT_TEMPLATES:
            title = template_data['title']

            # Check if template already exists (by title and no creator = system template)
            existing = NoteTemplate.objects.filter(
                title=title,
                created_by__isnull=True
            ).first()

            if existing:
                if force:
                    # Update existing template
                    for key, value in template_data.items():
                        setattr(existing, key, value)
                    existing.visibility = 'public'
                    existing.is_active = True
                    existing.save()
                    updated_count += 1
                    self.stdout.write(f'  Updated: {title}')
                else:
                    skipped_count += 1
                    self.stdout.write(f'  Skipped (exists): {title}')
            else:
                # Create new template
                NoteTemplate.objects.create(
                    title=title,
                    description=template_data['description'],
                    category=template_data['category'],
                    icon=template_data['icon'],
                    estimated_steps=template_data['estimated_steps'],
                    structure=template_data['structure'],
                    visibility='public',
                    is_public=True,
                    is_active=True,
                    created_by=None,  # System template
                )
                created_count += 1
                self.stdout.write(self.style.SUCCESS(f'  Created: {title}'))

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS(
            f'Done! Created: {created_count}, Updated: {updated_count}, Skipped: {skipped_count}'
        ))
