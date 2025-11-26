from django.core.management.base import BaseCommand
from django.db import transaction
from apps.laboratory.models import LabTestCatalog, LabPanel


class Command(BaseCommand):
    help = 'Seed lab test catalog with common tests and panels'

    def handle(self, *args, **options):
        self.stdout.write('Seeding lab test catalog...')

        with transaction.atomic():
            # Clear existing data
            LabPanel.objects.all().delete()
            LabTestCatalog.objects.all().delete()

            # Create individual tests
            tests_created = self.create_tests()
            self.stdout.write(self.style.SUCCESS(f'Created {tests_created} lab tests'))

            # Create panels
            panels_created = self.create_panels()
            self.stdout.write(self.style.SUCCESS(f'Created {panels_created} lab panels'))

        self.stdout.write(self.style.SUCCESS('Lab catalog seeded successfully!'))

    def create_tests(self):
        """Create individual lab tests"""
        tests_data = [
            # Hematology
            {
                'code': 'WBC',
                'loinc_code': '6690-2',
                'name': 'White Blood Cell Count',
                'short_name': 'WBC',
                'category': 'hematology',
                'description': 'Total white blood cell count',
                'specimen_type': 'Whole Blood',
                'container_type': 'Lavender Top (EDTA)',
                'volume_required': '3 mL',
                'reference_ranges': {
                    'adult': {'low': 4.5, 'high': 11.0, 'unit': 'K/uL'}
                },
                'unit': 'K/uL',
                'tat_hours': 2,
                'price': 15.00,
            },
            {
                'code': 'RBC',
                'loinc_code': '789-8',
                'name': 'Red Blood Cell Count',
                'short_name': 'RBC',
                'category': 'hematology',
                'description': 'Total red blood cell count',
                'specimen_type': 'Whole Blood',
                'container_type': 'Lavender Top (EDTA)',
                'volume_required': '3 mL',
                'reference_ranges': {
                    'adult_male': {'low': 4.5, 'high': 5.9, 'unit': 'M/uL'},
                    'adult_female': {'low': 4.1, 'high': 5.1, 'unit': 'M/uL'}
                },
                'unit': 'M/uL',
                'tat_hours': 2,
                'price': 15.00,
            },
            {
                'code': 'HGB',
                'loinc_code': '718-7',
                'name': 'Hemoglobin',
                'short_name': 'Hemoglobin',
                'category': 'hematology',
                'description': 'Hemoglobin concentration',
                'specimen_type': 'Whole Blood',
                'container_type': 'Lavender Top (EDTA)',
                'volume_required': '3 mL',
                'reference_ranges': {
                    'adult_male': {'low': 13.5, 'high': 17.5, 'unit': 'g/dL'},
                    'adult_female': {'low': 12.0, 'high': 15.5, 'unit': 'g/dL'}
                },
                'unit': 'g/dL',
                'tat_hours': 2,
                'price': 15.00,
            },
            {
                'code': 'HCT',
                'loinc_code': '4544-3',
                'name': 'Hematocrit',
                'short_name': 'Hematocrit',
                'category': 'hematology',
                'description': 'Packed cell volume',
                'specimen_type': 'Whole Blood',
                'container_type': 'Lavender Top (EDTA)',
                'volume_required': '3 mL',
                'reference_ranges': {
                    'adult_male': {'low': 38.3, 'high': 48.6, 'unit': '%'},
                    'adult_female': {'low': 35.5, 'high': 44.9, 'unit': '%'}
                },
                'unit': '%',
                'tat_hours': 2,
                'price': 15.00,
            },
            {
                'code': 'PLT',
                'loinc_code': '777-3',
                'name': 'Platelet Count',
                'short_name': 'Platelets',
                'category': 'hematology',
                'description': 'Platelet count',
                'specimen_type': 'Whole Blood',
                'container_type': 'Lavender Top (EDTA)',
                'volume_required': '3 mL',
                'reference_ranges': {
                    'adult': {'low': 150, 'high': 400, 'unit': 'K/uL'}
                },
                'unit': 'K/uL',
                'tat_hours': 2,
                'price': 15.00,
            },

            # Chemistry - Basic Metabolic Panel
            {
                'code': 'GLUCOSE',
                'loinc_code': '2345-7',
                'name': 'Glucose',
                'short_name': 'Glucose',
                'category': 'chemistry',
                'description': 'Blood glucose level',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'fasting': {'low': 70, 'high': 100, 'unit': 'mg/dL'},
                    'random': {'low': 70, 'high': 140, 'unit': 'mg/dL'}
                },
                'unit': 'mg/dL',
                'tat_hours': 2,
                'price': 20.00,
            },
            {
                'code': 'BUN',
                'loinc_code': '3094-0',
                'name': 'Blood Urea Nitrogen',
                'short_name': 'BUN',
                'category': 'chemistry',
                'description': 'Kidney function marker',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'adult': {'low': 7, 'high': 20, 'unit': 'mg/dL'}
                },
                'unit': 'mg/dL',
                'tat_hours': 2,
                'price': 20.00,
            },
            {
                'code': 'CREATININE',
                'loinc_code': '2160-0',
                'name': 'Creatinine',
                'short_name': 'Creatinine',
                'category': 'chemistry',
                'description': 'Kidney function marker',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'adult_male': {'low': 0.7, 'high': 1.3, 'unit': 'mg/dL'},
                    'adult_female': {'low': 0.6, 'high': 1.1, 'unit': 'mg/dL'}
                },
                'unit': 'mg/dL',
                'tat_hours': 2,
                'price': 20.00,
            },
            {
                'code': 'SODIUM',
                'loinc_code': '2951-2',
                'name': 'Sodium',
                'short_name': 'Sodium',
                'category': 'chemistry',
                'description': 'Serum sodium level',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'adult': {'low': 136, 'high': 145, 'unit': 'mmol/L'}
                },
                'unit': 'mmol/L',
                'tat_hours': 2,
                'price': 20.00,
            },
            {
                'code': 'POTASSIUM',
                'loinc_code': '2823-3',
                'name': 'Potassium',
                'short_name': 'Potassium',
                'category': 'chemistry',
                'description': 'Serum potassium level',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'adult': {'low': 3.5, 'high': 5.0, 'unit': 'mmol/L'}
                },
                'unit': 'mmol/L',
                'tat_hours': 2,
                'price': 20.00,
            },
            {
                'code': 'CHLORIDE',
                'loinc_code': '2075-0',
                'name': 'Chloride',
                'short_name': 'Chloride',
                'category': 'chemistry',
                'description': 'Serum chloride level',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'adult': {'low': 98, 'high': 107, 'unit': 'mmol/L'}
                },
                'unit': 'mmol/L',
                'tat_hours': 2,
                'price': 20.00,
            },
            {
                'code': 'CO2',
                'loinc_code': '2028-9',
                'name': 'Carbon Dioxide',
                'short_name': 'CO2',
                'category': 'chemistry',
                'description': 'Total carbon dioxide (bicarbonate)',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'adult': {'low': 23, 'high': 29, 'unit': 'mmol/L'}
                },
                'unit': 'mmol/L',
                'tat_hours': 2,
                'price': 20.00,
            },

            # Liver Function Tests
            {
                'code': 'ALT',
                'loinc_code': '1742-6',
                'name': 'Alanine Aminotransferase',
                'short_name': 'ALT',
                'category': 'chemistry',
                'description': 'Liver enzyme',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'adult': {'low': 7, 'high': 56, 'unit': 'U/L'}
                },
                'unit': 'U/L',
                'tat_hours': 4,
                'price': 25.00,
            },
            {
                'code': 'AST',
                'loinc_code': '1920-8',
                'name': 'Aspartate Aminotransferase',
                'short_name': 'AST',
                'category': 'chemistry',
                'description': 'Liver enzyme',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'adult': {'low': 10, 'high': 40, 'unit': 'U/L'}
                },
                'unit': 'U/L',
                'tat_hours': 4,
                'price': 25.00,
            },
            {
                'code': 'ALP',
                'loinc_code': '6768-6',
                'name': 'Alkaline Phosphatase',
                'short_name': 'Alk Phos',
                'category': 'chemistry',
                'description': 'Liver and bone enzyme',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'adult': {'low': 44, 'high': 147, 'unit': 'U/L'}
                },
                'unit': 'U/L',
                'tat_hours': 4,
                'price': 25.00,
            },
            {
                'code': 'BILIRUBIN_TOTAL',
                'loinc_code': '1975-2',
                'name': 'Bilirubin, Total',
                'short_name': 'Total Bili',
                'category': 'chemistry',
                'description': 'Total bilirubin',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'adult': {'low': 0.1, 'high': 1.2, 'unit': 'mg/dL'}
                },
                'unit': 'mg/dL',
                'tat_hours': 4,
                'price': 25.00,
            },
            {
                'code': 'ALBUMIN',
                'loinc_code': '1751-7',
                'name': 'Albumin',
                'short_name': 'Albumin',
                'category': 'chemistry',
                'description': 'Serum albumin',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'adult': {'low': 3.5, 'high': 5.5, 'unit': 'g/dL'}
                },
                'unit': 'g/dL',
                'tat_hours': 4,
                'price': 25.00,
            },

            # Lipid Panel
            {
                'code': 'CHOLESTEROL',
                'loinc_code': '2093-3',
                'name': 'Total Cholesterol',
                'short_name': 'Cholesterol',
                'category': 'chemistry',
                'description': 'Total cholesterol level',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'desirable': {'low': 0, 'high': 200, 'unit': 'mg/dL'},
                    'borderline': {'low': 200, 'high': 239, 'unit': 'mg/dL'},
                    'high': {'low': 240, 'high': 999, 'unit': 'mg/dL'}
                },
                'unit': 'mg/dL',
                'tat_hours': 4,
                'price': 30.00,
                'special_instructions': 'Fasting preferred but not required',
            },
            {
                'code': 'TRIGLYCERIDES',
                'loinc_code': '2571-8',
                'name': 'Triglycerides',
                'short_name': 'Triglycerides',
                'category': 'chemistry',
                'description': 'Serum triglycerides',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'normal': {'low': 0, 'high': 150, 'unit': 'mg/dL'},
                    'borderline': {'low': 150, 'high': 199, 'unit': 'mg/dL'},
                    'high': {'low': 200, 'high': 499, 'unit': 'mg/dL'}
                },
                'unit': 'mg/dL',
                'tat_hours': 4,
                'price': 30.00,
                'special_instructions': '12-hour fasting required',
            },
            {
                'code': 'HDL',
                'loinc_code': '2085-9',
                'name': 'HDL Cholesterol',
                'short_name': 'HDL',
                'category': 'chemistry',
                'description': 'High-density lipoprotein cholesterol',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'male_low': {'low': 0, 'high': 40, 'unit': 'mg/dL'},
                    'male_normal': {'low': 40, 'high': 60, 'unit': 'mg/dL'},
                    'female_low': {'low': 0, 'high': 50, 'unit': 'mg/dL'},
                    'female_normal': {'low': 50, 'high': 999, 'unit': 'mg/dL'}
                },
                'unit': 'mg/dL',
                'tat_hours': 4,
                'price': 30.00,
            },
            {
                'code': 'LDL',
                'loinc_code': '18262-6',
                'name': 'LDL Cholesterol',
                'short_name': 'LDL',
                'category': 'chemistry',
                'description': 'Low-density lipoprotein cholesterol',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'optimal': {'low': 0, 'high': 100, 'unit': 'mg/dL'},
                    'near_optimal': {'low': 100, 'high': 129, 'unit': 'mg/dL'},
                    'borderline': {'low': 130, 'high': 159, 'unit': 'mg/dL'},
                    'high': {'low': 160, 'high': 189, 'unit': 'mg/dL'}
                },
                'unit': 'mg/dL',
                'tat_hours': 4,
                'price': 30.00,
            },

            # Diabetes Management
            {
                'code': 'HBA1C',
                'loinc_code': '4548-4',
                'name': 'Hemoglobin A1c',
                'short_name': 'HbA1c',
                'category': 'chemistry',
                'description': 'Glycated hemoglobin (diabetes monitoring)',
                'specimen_type': 'Whole Blood',
                'container_type': 'Lavender Top (EDTA)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'normal': {'low': 4.0, 'high': 5.6, 'unit': '%'},
                    'prediabetes': {'low': 5.7, 'high': 6.4, 'unit': '%'},
                    'diabetes': {'low': 6.5, 'high': 15.0, 'unit': '%'}
                },
                'unit': '%',
                'tat_hours': 24,
                'price': 45.00,
            },

            # Thyroid Function
            {
                'code': 'TSH',
                'loinc_code': '3016-3',
                'name': 'Thyroid Stimulating Hormone',
                'short_name': 'TSH',
                'category': 'immunology',
                'description': 'Thyroid function marker',
                'specimen_type': 'Serum',
                'container_type': 'Red Top or Gold Top (SST)',
                'volume_required': '2 mL',
                'reference_ranges': {
                    'adult': {'low': 0.4, 'high': 4.0, 'unit': 'mIU/L'}
                },
                'unit': 'mIU/L',
                'tat_hours': 24,
                'price': 40.00,
            },

            # Urinalysis
            {
                'code': 'UA',
                'loinc_code': '5778-6',
                'name': 'Urinalysis, Complete',
                'short_name': 'Urinalysis',
                'category': 'urinalysis',
                'description': 'Complete urinalysis with microscopy',
                'specimen_type': 'Urine',
                'container_type': 'Sterile Cup',
                'volume_required': '10 mL',
                'reference_ranges': {
                    'color': {'value': 'Yellow', 'unit': 'text'},
                    'clarity': {'value': 'Clear', 'unit': 'text'},
                    'specific_gravity': {'low': 1.005, 'high': 1.030, 'unit': ''},
                    'pH': {'low': 4.5, 'high': 8.0, 'unit': ''}
                },
                'unit': 'various',
                'tat_hours': 4,
                'price': 25.00,
                'special_instructions': 'Clean catch midstream specimen preferred',
            },
        ]

        tests = []
        for data in tests_data:
            test = LabTestCatalog.objects.create(**data)
            tests.append(test)

        return len(tests)

    def create_panels(self):
        """Create lab panels"""
        panels_data = [
            {
                'code': 'CBC',
                'name': 'Complete Blood Count',
                'description': 'Comprehensive blood cell evaluation',
                'test_codes': ['WBC', 'RBC', 'HGB', 'HCT', 'PLT'],
                'price': 65.00,
            },
            {
                'code': 'BMP',
                'name': 'Basic Metabolic Panel',
                'description': 'Basic chemistry panel - kidney function and electrolytes',
                'test_codes': ['GLUCOSE', 'BUN', 'CREATININE', 'SODIUM', 'POTASSIUM', 'CHLORIDE', 'CO2'],
                'price': 120.00,
            },
            {
                'code': 'CMP',
                'name': 'Comprehensive Metabolic Panel',
                'description': 'Complete chemistry panel - kidney, liver, and electrolytes',
                'test_codes': ['GLUCOSE', 'BUN', 'CREATININE', 'SODIUM', 'POTASSIUM', 'CHLORIDE', 'CO2', 'ALT', 'AST', 'ALP', 'BILIRUBIN_TOTAL', 'ALBUMIN'],
                'price': 180.00,
            },
            {
                'code': 'LFT',
                'name': 'Liver Function Tests',
                'description': 'Comprehensive liver enzyme panel',
                'test_codes': ['ALT', 'AST', 'ALP', 'BILIRUBIN_TOTAL', 'ALBUMIN'],
                'price': 110.00,
            },
            {
                'code': 'LIPID',
                'name': 'Lipid Panel',
                'description': 'Comprehensive cholesterol and lipid evaluation',
                'test_codes': ['CHOLESTEROL', 'TRIGLYCERIDES', 'HDL', 'LDL'],
                'price': 95.00,
            },
        ]

        panels = []
        for data in panels_data:
            test_codes = data.pop('test_codes')
            panel = LabPanel.objects.create(
                code=data['code'],
                name=data['name'],
                description=data['description'],
                price=data['price'],
            )

            # Add tests to panel
            tests = LabTestCatalog.objects.filter(code__in=test_codes)
            panel.tests.set(tests)

            panels.append(panel)

        return len(panels)
