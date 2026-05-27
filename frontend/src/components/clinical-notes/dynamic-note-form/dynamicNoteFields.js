export const VITAL_FIELDS = [
  {
    name: 'heart_rate',
    idSuffix: 'heart-rate',
    label: 'Heart Rate (bpm)',
    type: 'number',
    placeholder: 'e.g., 72',
  },
  {
    name: 'respiratory_rate',
    idSuffix: 'respiratory-rate',
    label: 'Respiratory Rate (breaths/min)',
    type: 'number',
    placeholder: 'e.g., 16',
  },
  {
    name: 'temperature',
    idSuffix: 'temperature',
    label: 'Temperature (°C)',
    type: 'number',
    step: '0.1',
    placeholder: 'e.g., 37.0',
  },
  {
    name: 'oxygen_saturation',
    idSuffix: 'oxygen-saturation',
    label: 'Oxygen Saturation (%)',
    type: 'number',
    placeholder: 'e.g., 98',
  },
  {
    name: 'blood_pressure_systolic',
    idSuffix: 'bp-systolic',
    label: 'Blood Pressure (Systolic)',
    type: 'number',
    placeholder: 'e.g., 120',
  },
  {
    name: 'blood_pressure_diastolic',
    idSuffix: 'bp-diastolic',
    label: 'Blood Pressure (Diastolic)',
    type: 'number',
    placeholder: 'e.g., 80',
  },
];

export const FLUID_INTAKE_FIELDS = [
  {
    name: 'oral_intake',
    idSuffix: 'oral-intake',
    label: 'Oral Intake (mL)',
    type: 'number',
    placeholder: 'e.g., 800',
  },
  {
    name: 'iv_intake',
    idSuffix: 'iv-intake',
    label: 'IV Fluids (mL)',
    type: 'number',
    placeholder: 'e.g., 500',
  },
  {
    name: 'ng_tube',
    idSuffix: 'ng-tube',
    label: 'NG Tube Feeding (mL)',
    type: 'number',
    placeholder: 'e.g., 300',
  },
  {
    name: 'tpn',
    idSuffix: 'tpn',
    label: 'TPN (mL)',
    type: 'number',
    placeholder: 'e.g., 250',
  },
  {
    name: 'other_intake',
    idSuffix: 'other-intake',
    label: 'Other Intake (mL)',
    type: 'number',
    placeholder: 'e.g., 100',
  },
];

export const FLUID_OUTPUT_FIELDS = [
  {
    name: 'urine',
    idSuffix: 'urine',
    label: 'Urine Output (mL)',
    type: 'number',
    placeholder: 'e.g., 1200',
  },
  {
    name: 'ng_aspirate',
    idSuffix: 'ng-aspirate',
    label: 'N/G Aspirate (mL)',
    type: 'number',
    placeholder: 'e.g., 50',
  },
  {
    name: 'drain_fluid',
    idSuffix: 'drain-fluid',
    label: 'Fluid from Drains (mL)',
    type: 'number',
    placeholder: 'e.g., 100',
  },
  {
    name: 'stoma',
    idSuffix: 'stoma',
    label: 'Stoma Output (mL)',
    type: 'number',
    placeholder: 'e.g., 200',
  },
  {
    name: 'stool',
    idSuffix: 'stool',
    label: 'Stool (mL)',
    type: 'number',
    placeholder: 'e.g., 150',
  },
  {
    name: 'other_output',
    idSuffix: 'other-output',
    label: 'Other Output (mL)',
    type: 'number',
    placeholder: 'e.g., 50',
  },
];

export const MEDICATION_FIELDS = [
  {
    name: 'medication',
    idSuffix: 'medication',
    label: 'Medication',
    type: 'text',
    placeholder: 'e.g., Paracetamol',
  },
  {
    name: 'dosage',
    idSuffix: 'dosage',
    label: 'Dosage',
    type: 'text',
    placeholder: 'e.g., 500mg, twice daily',
  },
];
