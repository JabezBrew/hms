"""
Electrolyte panel tests.
LOINC codes sourced from loinc.org
"""

ELECTROLYTE_TESTS = [
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
            'adult': {'low': 136, 'high': 145, 'unit': 'mmol/L'},
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
            'adult': {'low': 3.5, 'high': 5.0, 'unit': 'mmol/L'},
        },
        'unit': 'mmol/L',
        'tat_hours': 2,
        'price': 20.00,
        'special_instructions': 'Avoid hemolysis - falsely elevates potassium',
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
            'adult': {'low': 98, 'high': 107, 'unit': 'mmol/L'},
        },
        'unit': 'mmol/L',
        'tat_hours': 2,
        'price': 20.00,
    },
    {
        'code': 'CO2',
        'loinc_code': '2028-9',
        'name': 'Carbon Dioxide (Bicarbonate)',
        'short_name': 'CO2',
        'category': 'chemistry',
        'description': 'Total carbon dioxide (bicarbonate) - acid-base balance',
        'specimen_type': 'Serum',
        'container_type': 'Red Top or Gold Top (SST)',
        'volume_required': '2 mL',
        'reference_ranges': {
            'adult': {'low': 23, 'high': 29, 'unit': 'mmol/L'},
        },
        'unit': 'mmol/L',
        'tat_hours': 2,
        'price': 20.00,
    },
    {
        'code': 'ANION_GAP',
        'loinc_code': '33037-3',
        'name': 'Anion Gap',
        'short_name': 'Anion Gap',
        'category': 'chemistry',
        'description': 'Calculated anion gap - metabolic acidosis workup',
        'specimen_type': 'Serum',
        'container_type': 'Red Top or Gold Top (SST)',
        'volume_required': '2 mL',
        'reference_ranges': {
            'adult': {'low': 8, 'high': 12, 'unit': 'mmol/L'},
        },
        'unit': 'mmol/L',
        'tat_hours': 2,
        'price': 0.00,  # Usually calculated from other electrolytes
        'special_instructions': 'Calculated value: Na - (Cl + CO2)',
    },
]
