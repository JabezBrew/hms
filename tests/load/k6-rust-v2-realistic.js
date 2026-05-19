/**
 * Rust V2 realistic load test for HMS.
 *
 * This suite models concurrent hospital staff, not raw endpoint hammering:
 * - per-VU login/session refresh
 * - role-weighted workflows
 * - realistic think time
 * - shared operational objects from the target environment
 * - opt-in synthetic writes for staging
 *
 * Keep output PHI-safe. The script logs counts, routes, status codes, and
 * aggregate metrics only; it never logs response bodies.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = trimTrailingSlash(__ENV.HMS_LOAD_BASE_URL || __ENV.BASE_URL || 'http://127.0.0.1:8080');
const FACILITY_CODE = __ENV.HMS_LOAD_FACILITY_CODE || 'HMS';
const PROFILE = (__ENV.HMS_LOAD_PROFILE || 'smoke').toLowerCase();
const ENABLE_WRITES = truthy(__ENV.HMS_LOAD_ENABLE_WRITES);
const INCLUDE_OPD_RUSH = truthy(__ENV.HMS_LOAD_INCLUDE_OPD_RUSH);
const DEBUG_FAILURES = truthy(__ENV.HMS_LOAD_DEBUG_FAILURES);
const BUDGET_MULTIPLIER = positiveFloat(__ENV.HMS_LOAD_BUDGET_MULTIPLIER, 1);
const THINK_TIME_SCALE = positiveFloat(__ENV.HMS_LOAD_THINK_TIME_SCALE, 1);
const TOKEN_REFRESH_SECONDS = positiveInt(__ENV.HMS_LOAD_TOKEN_REFRESH_SECONDS, 8 * 60);
const REQUEST_TIMEOUT = __ENV.HMS_LOAD_REQUEST_TIMEOUT || '30s';

const WORKFLOW_FILTER = parseList(__ENV.HMS_LOAD_WORKFLOWS);
const ALL_WORKFLOWS = ['reception', 'doctor', 'nurse', 'lab', 'pharmacy', 'billing', 'admin'];

const rolePlan = [
  { role: 'nurse', weight: 35 },
  { role: 'doctor', weight: 25 },
  { role: 'reception', weight: 15 },
  { role: 'lab', weight: 8 },
  { role: 'pharmacy', weight: 7 },
  { role: 'billing', weight: 7 },
  { role: 'admin', weight: 3 },
];

const errors = new Rate('hms_errors');
const skippedWrites = new Counter('hms_skipped_writes');
const failedRequests = new Counter('hms_failed_requests');
const sessionRefreshes = new Counter('hms_session_refreshes');
const syntheticWrites = new Counter('hms_synthetic_writes');

const authMeTrend = new Trend('hms_auth_me', true);
const patientListTrend = new Trend('hms_patient_list', true);
const patientChronicleTrend = new Trend('hms_patient_chronicle', true);
const searchTrend = new Trend('hms_search', true);
const wardBoardTrend = new Trend('hms_ward_board', true);
const clinicalWriteTrend = new Trend('hms_clinical_write', true);
const operationalWriteTrend = new Trend('hms_operational_write', true);
const labTrend = new Trend('hms_laboratory', true);
const inventoryTrend = new Trend('hms_inventory', true);
const billingTrend = new Trend('hms_billing', true);

export const options = buildOptions();

const sessions = {};

export function setup() {
  const runId = __ENV.HMS_LOAD_RUN_ID || `lt${Date.now().toString(36)}${randomInt(100, 999)}`;
  const credentials = loadCredentials();
  const activeRoles = buildActiveRoles(credentials);

  if (activeRoles.length === 0) {
    throw new Error('No load-test credentials matched the enabled workflows.');
  }

  const probeRole = credentials.admin ? 'admin' : activeRoles[0].role;
  const probeSession = loginWithCredentials(probeRole, credentials[probeRole]);
  if (!probeSession) {
    throw new Error(`Unable to authenticate probe role: ${probeRole}`);
  }

  const health = request('GET', '/api/v2/health/ready', {
    role: 'setup',
    route: '/api/v2/health/ready',
    expected: [200],
  });
  if (health.status !== 200) {
    throw new Error(`Readiness check failed with status ${health.status}`);
  }

  const fixture = collectFixture(probeSession);
  if (ENABLE_WRITES) {
    seedMinimalWriteFixture(probeSession, fixture, runId);
  }
  if (workflowEnabled('doctor')) {
    fixture.chroniclePatientIds = filterChroniclePatientIds(probeSession, fixture.patientIds);
  }

  console.log(
    [
      `HMS Rust V2 load profile=${PROFILE}`,
      `base=${BASE_URL}`,
      `facility=${FACILITY_CODE}`,
      `roles=${activeRoles.map((item) => item.role).join(',')}`,
      `writes=${ENABLE_WRITES ? 'enabled' : 'disabled'}`,
      `patients=${fixture.patientIds.length}`,
      `chronicle_patients=${fixture.chroniclePatientIds.length}`,
      `wards=${fixture.wardIds.length}`,
      `admission_cases=${fixture.admissionCaseIds.length}`,
      `lab_tests=${fixture.labTestIds.length}`,
      `inventory_items=${fixture.inventoryItemIds.length}`,
    ].join(' ')
  );

  return { activeRoles, credentials, fixture, runId };
}

export function staffWorkday(data) {
  const role = chooseRole(data.activeRoles);
  const session = sessionFor(role, data.credentials);
  if (!session) {
    sleep(1);
    return;
  }

  group(`staff:${role}`, () => {
    commonSessionChecks(session, role);

    switch (role) {
      case 'nurse':
        nurseWardWorkflow(session, data);
        break;
      case 'doctor':
        doctorConsultWorkflow(session, data);
        break;
      case 'reception':
        receptionWorkflow(session, data);
        break;
      case 'lab':
        labWorkflow(session, data);
        break;
      case 'pharmacy':
        pharmacyWorkflow(session, data);
        break;
      case 'billing':
        billingWorkflow(session, data);
        break;
      default:
        adminWorkflow(session, data);
        break;
    }
  });
}

export function opdRush(data) {
  const role = data.credentials.reception ? 'reception' : data.activeRoles[0].role;
  const session = sessionFor(role, data.credentials);
  if (!session) {
    sleep(1);
    return;
  }

  group('arrival:opd-rush', () => {
    if (ENABLE_WRITES) {
      const patientId = createSyntheticPatient(session, data.runId);
      if (patientId) {
        createAppointment(session, patientId);
        const visitId = checkInVisit(session, patientId);
        if (visitId) {
          createTriage(session, visitId);
        }
      }
    } else {
      getJson(session, '/api/v2/patients?limit=20&search=Ama', {
        role,
        route: '/api/v2/patients',
        metric: patientListTrend,
      });
      getJson(session, '/api/v2/appointments?limit=20', {
        role,
        route: '/api/v2/appointments',
      });
    }
    think(2, 8);
  });
}

function commonSessionChecks(session, role) {
  if (randomChance(0.35)) {
    getJson(session, '/api/v2/auth/me', {
      role,
      route: '/api/v2/auth/me',
      metric: authMeTrend,
    });
  }

  if (randomChance(0.2)) {
    getJson(session, '/api/v2/notifications/counts', {
      role,
      route: '/api/v2/notifications/counts',
    });
  }
}

function nurseWardWorkflow(session, data) {
  getJson(session, '/api/v2/dashboards/snapshot', {
    role: 'nurse',
    route: '/api/v2/dashboards/snapshot',
  });
  getJson(session, '/api/v2/wards/board?limit=25', {
    role: 'nurse',
    route: '/api/v2/wards/board',
    metric: wardBoardTrend,
  });
  getJson(session, '/api/v2/nursing/tasks?limit=20', {
    role: 'nurse',
    route: '/api/v2/nursing/tasks',
  });
  getJson(session, '/api/v2/nursing/alerts?limit=20', {
    role: 'nurse',
    route: '/api/v2/nursing/alerts',
  });

  const admissionCaseId = pick(data.fixture.admissionCaseIds);
  if (admissionCaseId) {
    getJson(session, `/api/v2/nursing/vitals${qs({ limit: 10, admission_case_id: admissionCaseId })}`, {
      role: 'nurse',
      route: '/api/v2/nursing/vitals',
    });

    if (ENABLE_WRITES && randomChance(0.25)) {
      recordVitals(session, admissionCaseId);
    }
  } else {
    skippedWrites.add(1, { workflow: 'nurse', reason: 'no_admission_case' });
  }

  think(4, 18);
}

function doctorConsultWorkflow(session, data) {
  const searchTerm = pick(['Ama', 'Kojo', 'Grace', 'General', 'Clinic']);
  getJson(session, `/api/v2/patients${qs({ limit: 20, search: searchTerm })}`, {
    role: 'doctor',
    route: '/api/v2/patients',
    metric: patientListTrend,
  });
  postJson(session, '/api/v2/search/omni', {
    q: searchTerm,
    types: ['patients', 'appointments', 'laboratory'],
    limit: 8,
  }, {
    role: 'doctor',
    route: '/api/v2/search/omni',
    metric: searchTrend,
  });
  getJson(session, '/api/v2/visits?limit=20', {
    role: 'doctor',
    route: '/api/v2/visits',
  });
  getJson(session, '/api/v2/triage?limit=20', {
    role: 'doctor',
    route: '/api/v2/triage',
  });

  const patientId = pick(data.fixture.chroniclePatientIds);
  if (patientId) {
    getJson(session, `/api/v2/patients/${patientId}/chronicle`, {
      role: 'doctor',
      route: '/api/v2/patients/:id/chronicle',
      metric: patientChronicleTrend,
    });
    getJson(session, `/api/v2/patients/${patientId}/clinical/notes?limit=10`, {
      role: 'doctor',
      route: '/api/v2/patients/:patient_id/clinical/notes',
    });

    if (ENABLE_WRITES && randomChance(0.2)) {
      createClinicalNote(session, patientId);
    }

    if (ENABLE_WRITES && data.fixture.labTestIds.length > 0 && randomChance(0.12)) {
      createLabOrder(session, patientId, pick(data.fixture.labTestIds));
    }
  } else {
    skippedWrites.add(1, { workflow: 'doctor', reason: 'no_chronicle_patient' });
  }

  think(6, 30);
}

function receptionWorkflow(session, data) {
  getJson(session, '/api/v2/appointments?limit=20', {
    role: 'reception',
    route: '/api/v2/appointments',
  });
  getJson(session, '/api/v2/patients?limit=20&search=Ama', {
    role: 'reception',
    route: '/api/v2/patients',
    metric: patientListTrend,
  });
  getJson(session, '/api/v2/appointment-types?limit=20', {
    role: 'reception',
    route: '/api/v2/appointment-types',
  });
  getJson(session, '/api/v2/clinics?limit=20', {
    role: 'reception',
    route: '/api/v2/clinics',
  });

  if (ENABLE_WRITES && randomChance(0.18)) {
    const patientId = createSyntheticPatient(session, data.runId);
    if (patientId) {
      createAppointment(session, patientId);
      if (randomChance(0.45)) {
        const visitId = checkInVisit(session, patientId);
        if (visitId && randomChance(0.5)) {
          createTriage(session, visitId);
        }
      }
    }
  }

  think(3, 14);
}

function labWorkflow(session, data) {
  getJson(session, '/api/v2/laboratory/orders?limit=20', {
    role: 'lab',
    route: '/api/v2/laboratory/orders',
    metric: labTrend,
  });
  getJson(session, '/api/v2/laboratory/test-catalog?limit=20', {
    role: 'lab',
    route: '/api/v2/laboratory/test-catalog',
    metric: labTrend,
  });
  getJson(session, '/api/v2/laboratory/specimens?limit=20', {
    role: 'lab',
    route: '/api/v2/laboratory/specimens',
    metric: labTrend,
  });
  getJson(session, '/api/v2/laboratory/results?limit=20', {
    role: 'lab',
    route: '/api/v2/laboratory/results',
    metric: labTrend,
  });

  if (ENABLE_WRITES && randomChance(0.08)) {
    const patientId = pick(data.fixture.patientIds);
    const testId = pick(data.fixture.labTestIds);
    if (patientId && testId) {
      createLabOrder(session, patientId, testId);
    } else {
      skippedWrites.add(1, { workflow: 'lab', reason: 'missing_patient_or_test' });
    }
  }

  think(5, 22);
}

function pharmacyWorkflow(session, data) {
  getJson(session, '/api/v2/inventory/dashboard-summary', {
    role: 'pharmacy',
    route: '/api/v2/inventory/dashboard-summary',
    metric: inventoryTrend,
  });
  getJson(session, '/api/v2/inventory/items?limit=20', {
    role: 'pharmacy',
    route: '/api/v2/inventory/items',
    metric: inventoryTrend,
  });
  getJson(session, '/api/v2/inventory/storage-locations?limit=20', {
    role: 'pharmacy',
    route: '/api/v2/inventory/storage-locations',
    metric: inventoryTrend,
  });
  getJson(session, '/api/v2/pharmacy/dispenses?limit=20', {
    role: 'pharmacy',
    route: '/api/v2/pharmacy/dispenses',
    metric: inventoryTrend,
  });
  getJson(session, '/api/v2/patients?limit=10&search=Ama', {
    role: 'pharmacy',
    route: '/api/v2/patients',
    metric: patientListTrend,
  });

  if (ENABLE_WRITES && randomChance(0.08)) {
    createPharmacyDispense(session, data.fixture);
  }

  think(5, 20);
}

function billingWorkflow(session, data) {
  getJson(session, '/api/v2/billing/dashboard-summary', {
    role: 'billing',
    route: '/api/v2/billing/dashboard-summary',
    metric: billingTrend,
  });
  getJson(session, '/api/v2/billing/invoices?limit=20', {
    role: 'billing',
    route: '/api/v2/billing/invoices',
    metric: billingTrend,
  });
  getJson(session, '/api/v2/billing/payments?limit=20', {
    role: 'billing',
    route: '/api/v2/billing/payments',
    metric: billingTrend,
  });
  getJson(session, '/api/v2/billing/service-prices?limit=20', {
    role: 'billing',
    route: '/api/v2/billing/service-prices',
    metric: billingTrend,
  });
  getJson(session, '/api/v2/nhis/claims?limit=20', {
    role: 'billing',
    route: '/api/v2/nhis/claims',
    metric: billingTrend,
  });

  if (ENABLE_WRITES && randomChance(0.08)) {
    createInvoice(session, data.fixture);
  }

  think(4, 18);
}

function adminWorkflow(session) {
  getJson(session, '/api/v2/dashboards/admin-v2/capacity', {
    role: 'admin',
    route: '/api/v2/dashboards/admin-v2/capacity',
  });
  getJson(session, '/api/v2/staff/directory?limit=20', {
    role: 'admin',
    route: '/api/v2/staff/directory',
  });
  getJson(session, '/api/v2/admin/audit-events?limit=20', {
    role: 'admin',
    route: '/api/v2/admin/audit-events',
  });
  getJson(session, '/api/v2/system/deployment-capabilities', {
    role: 'admin',
    route: '/api/v2/system/deployment-capabilities',
  });

  think(8, 30);
}

function collectFixture(session) {
  const fixture = {
    patientIds: [],
    chroniclePatientIds: [],
    wardIds: [],
    bedIds: [],
    admissionCaseIds: [],
    visitIds: [],
    labTestIds: [],
    inventoryItemIds: [],
    locationIds: [],
    servicePriceIds: [],
  };

  fixture.patientIds = listIds(getJson(session, '/api/v2/patients?limit=50', {
    role: 'setup',
    route: '/api/v2/patients',
    metric: patientListTrend,
  }));

  if (workflowEnabled('nurse') || ENABLE_WRITES) {
    fixture.wardIds = listIds(getJson(session, '/api/v2/wards?limit=25', {
      role: 'setup',
      route: '/api/v2/wards',
    }));
    fixture.admissionCaseIds = listIds(getJson(session, '/api/v2/admissions/cases?limit=50', {
      role: 'setup',
      route: '/api/v2/admissions/cases',
    }));
  }

  if (workflowEnabled('doctor')) {
    fixture.visitIds = listIds(getJson(session, '/api/v2/visits?limit=50', {
      role: 'setup',
      route: '/api/v2/visits',
    }));
  }

  if (workflowEnabled('lab') || workflowEnabled('doctor')) {
    fixture.labTestIds = listIds(getJson(session, '/api/v2/laboratory/test-catalog?limit=50', {
      role: 'setup',
      route: '/api/v2/laboratory/test-catalog',
      metric: labTrend,
    }));
  }

  if (workflowEnabled('pharmacy')) {
    fixture.inventoryItemIds = listIds(getJson(session, '/api/v2/inventory/items?limit=50', {
      role: 'setup',
      route: '/api/v2/inventory/items',
      metric: inventoryTrend,
    }));
    fixture.locationIds = listIds(getJson(session, '/api/v2/inventory/storage-locations?limit=50', {
      role: 'setup',
      route: '/api/v2/inventory/storage-locations',
      metric: inventoryTrend,
    }));
  }

  if (workflowEnabled('billing')) {
    fixture.servicePriceIds = listIds(getJson(session, '/api/v2/billing/service-prices?limit=50', {
      role: 'setup',
      route: '/api/v2/billing/service-prices',
      metric: billingTrend,
    }));
  }

  if (fixture.wardIds.length > 0 && workflowEnabled('nurse')) {
    const beds = getJson(session, `/api/v2/wards/${fixture.wardIds[0]}/beds?limit=50`, {
      role: 'setup',
      route: '/api/v2/wards/:id/beds',
    });
    fixture.bedIds = listIds(beds);
  }

  return fixture;
}

function filterChroniclePatientIds(session, patientIds) {
  const accessible = [];
  for (const patientId of patientIds.slice(0, 20)) {
    const res = request('GET', `/api/v2/patients/${patientId}/chronicle`, {
      role: 'setup',
      route: '/api/v2/patients/:id/chronicle-access-probe',
      session,
      expected: [200, 403, 404],
      responseCallback: http.expectedStatuses(200, 403, 404),
    });
    if (res.status === 200) {
      accessible.push(patientId);
    }
  }
  return accessible;
}

function seedMinimalWriteFixture(session, fixture, runId) {
  if (fixture.patientIds.length === 0) {
    const patientId = createSyntheticPatient(session, runId);
    if (patientId) {
      fixture.patientIds.push(patientId);
    }
  }

  if (fixture.wardIds.length === 0) {
    const wardId = createSyntheticWard(session, runId);
    if (wardId) {
      fixture.wardIds.push(wardId);
    }
  }

  if (fixture.admissionCaseIds.length === 0 && fixture.patientIds.length > 0 && fixture.wardIds.length > 0) {
    const admissionCaseId = createAdmissionCase(session, fixture.patientIds[0], fixture.wardIds[0]);
    if (admissionCaseId) {
      fixture.admissionCaseIds.push(admissionCaseId);
    }
  }
}

function createSyntheticPatient(session, runId) {
  const suffix = safeSuffix(runId);
  const res = postJson(session, '/api/v2/patients', {
    first_name: 'LoadTest',
    last_name: `Patient${suffix}`,
    date_of_birth: '1991-03-14',
    sex: randomChance(0.5) ? 'female' : 'male',
  }, {
    role: 'write',
    route: '/api/v2/patients',
    metric: operationalWriteTrend,
    expected: [200, 201],
  });
  const id = objectId(res);
  if (id) syntheticWrites.add(1, { workflow: 'patient_registration' });
  return id;
}

function createSyntheticWard(session, runId) {
  const suffix = safeSuffix(runId).slice(0, 8);
  const res = postJson(session, '/api/v2/wards', {
    code: `LT${suffix}`,
    name: `Load Test Ward ${suffix}`,
  }, {
    role: 'write',
    route: '/api/v2/wards',
    metric: operationalWriteTrend,
    expected: [200, 201],
  });
  const id = objectId(res);
  if (id) syntheticWrites.add(1, { workflow: 'ward_setup' });
  return id;
}

function createAdmissionCase(session, patientId, wardId) {
  const created = postJson(session, '/api/v2/admissions/cases', {
    patient_id: patientId,
    ward_id: wardId,
  }, {
    role: 'write',
    route: '/api/v2/admissions/cases',
    metric: operationalWriteTrend,
    expected: [200, 201],
  });
  const admissionCaseId = objectId(created);
  if (!admissionCaseId) return null;

  postJson(session, `/api/v2/admissions/cases/${admissionCaseId}/activate`, {}, {
    role: 'write',
    route: '/api/v2/admissions/cases/:id/activate',
    metric: operationalWriteTrend,
    expected: [200, 201],
  });
  syntheticWrites.add(1, { workflow: 'admission_case' });
  return admissionCaseId;
}

function createAppointment(session, patientId) {
  const startsAt = new Date(Date.now() + randomInt(15, 240) * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
  const res = postJson(session, '/api/v2/appointments', {
    patient_id: patientId,
    clinic_id: null,
    clinic_session_id: null,
    appointment_type_id: null,
    practitioner_user_id: null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    overbook_reason: null,
  }, {
    role: 'reception',
    route: '/api/v2/appointments',
    metric: operationalWriteTrend,
    expected: [200, 201],
  });
  const id = objectId(res);
  if (id) syntheticWrites.add(1, { workflow: 'appointment' });
  return id;
}

function checkInVisit(session, patientId) {
  const res = postJson(session, '/api/v2/visits/check-in', {
    patient_id: patientId,
    appointment_id: null,
    clinic_id: null,
  }, {
    role: 'reception',
    route: '/api/v2/visits/check-in',
    metric: operationalWriteTrend,
    expected: [200, 201],
  });
  const id = objectId(res);
  if (id) syntheticWrites.add(1, { workflow: 'visit_check_in' });
  return id;
}

function createTriage(session, visitId) {
  const res = postJson(session, '/api/v2/triage', {
    visit_id: visitId,
    acuity: pick(['routine', 'urgent', 'emergency']),
  }, {
    role: 'reception',
    route: '/api/v2/triage',
    metric: operationalWriteTrend,
    expected: [200, 201],
  });
  const id = objectId(res);
  if (id) syntheticWrites.add(1, { workflow: 'triage' });
  return id;
}

function createClinicalNote(session, patientId) {
  const res = postJson(session, `/api/v2/patients/${patientId}/clinical/notes`, {
    note_type: 'progress',
    title: 'Load test progress note',
    body: 'Synthetic load-test note. No real patient information.',
  }, {
    role: 'doctor',
    route: '/api/v2/patients/:patient_id/clinical/notes',
    metric: clinicalWriteTrend,
    expected: [200, 201],
  });
  const id = objectId(res);
  if (id) syntheticWrites.add(1, { workflow: 'clinical_note' });
  return id;
}

function recordVitals(session, admissionCaseId) {
  const res = postJson(session, '/api/v2/nursing/vitals', {
    admission_case_id: admissionCaseId,
    recorded_at: new Date().toISOString(),
    temperature_c: randomFloat(36.0, 37.6, 1),
    systolic_bp: randomInt(105, 135),
    diastolic_bp: randomInt(65, 85),
    pulse: randomInt(62, 96),
    respiratory_rate: randomInt(12, 20),
    oxygen_saturation: randomInt(95, 100),
  }, {
    role: 'nurse',
    route: '/api/v2/nursing/vitals',
    metric: clinicalWriteTrend,
    expected: [200, 201],
  });
  const id = objectId(res);
  if (id) syntheticWrites.add(1, { workflow: 'vitals' });
  return id;
}

function createLabOrder(session, patientId, testId) {
  const res = postJson(session, '/api/v2/laboratory/orders', {
    patient_id: patientId,
    test_ids: [testId],
    panel_ids: [],
    priority: randomChance(0.15) ? 'urgent' : 'routine',
  }, {
    role: 'doctor',
    route: '/api/v2/laboratory/orders',
    metric: operationalWriteTrend,
    expected: [200, 201],
  });
  const id = objectId(res);
  if (id) {
    syntheticWrites.add(1, { workflow: 'lab_order' });
    if (randomChance(0.5)) {
      postJson(session, `/api/v2/laboratory/orders/${id}/submit`, {}, {
        role: 'doctor',
        route: '/api/v2/laboratory/orders/:id/submit',
        metric: operationalWriteTrend,
        expected: [200, 201],
      });
    }
  }
  return id;
}

function createPharmacyDispense(session, fixture) {
  const patientId = pick(fixture.patientIds);
  const itemId = pick(fixture.inventoryItemIds);
  const locationId = pick(fixture.locationIds);
  if (!patientId || !itemId || !locationId) {
    skippedWrites.add(1, { workflow: 'pharmacy', reason: 'missing_patient_item_or_location' });
    return null;
  }

  const res = postJson(session, '/api/v2/pharmacy/dispenses', {
    patient_id: patientId,
    item_id: itemId,
    location_id: locationId,
    quantity: 1,
  }, {
    role: 'pharmacy',
    route: '/api/v2/pharmacy/dispenses',
    metric: operationalWriteTrend,
    expected: [200, 201],
  });
  const id = objectId(res);
  if (id) syntheticWrites.add(1, { workflow: 'pharmacy_dispense' });
  return id;
}

function createInvoice(session, fixture) {
  const patientId = pick(fixture.patientIds);
  const servicePriceId = pick(fixture.servicePriceIds);
  if (!patientId || !servicePriceId) {
    skippedWrites.add(1, { workflow: 'billing', reason: 'missing_patient_or_service_price' });
    return null;
  }

  const res = postJson(session, '/api/v2/billing/invoices', {
    patient_id: patientId,
    service_price_id: servicePriceId,
    quantity: 1,
  }, {
    role: 'billing',
    route: '/api/v2/billing/invoices',
    metric: operationalWriteTrend,
    expected: [200, 201],
  });
  const id = objectId(res);
  if (id) syntheticWrites.add(1, { workflow: 'invoice' });
  return id;
}

function sessionFor(role, credentials) {
  const credential = credentials[role] || credentials.admin || credentials.reception || Object.values(credentials)[0];
  if (!credential) return null;

  const existing = sessions[role];
  const now = Date.now();
  if (!existing) {
    sessions[role] = loginWithCredentials(role, credential);
    return sessions[role];
  }

  if (now - existing.lastAuthenticatedAt > TOKEN_REFRESH_SECONDS * 1000) {
    const refreshed = refreshSession(existing, role);
    sessions[role] = refreshed || loginWithCredentials(role, credential);
  }

  return sessions[role];
}

function loginWithCredentials(role, credential) {
  const res = request('POST', '/api/v2/auth/login', {
    role,
    route: '/api/v2/auth/login',
    body: {
      email: credential.email,
      password: credential.password,
      facility_code: FACILITY_CODE,
    },
    expected: [200],
    tags: { auth_action: 'login' },
  });

  const payload = safeJson(res);
  const token = payload && payload.data && payload.data.access_token;
  if (!token) {
    if (DEBUG_FAILURES) {
      console.error(`login failed role=${role} status=${res.status}`);
    }
    return null;
  }

  return {
    role,
    accessToken: token,
    csrfToken: readCsrfCookie(),
    lastAuthenticatedAt: Date.now(),
  };
}

function refreshSession(session, role) {
  const csrfToken = readCsrfCookie() || session.csrfToken;
  const res = request('POST', '/api/v2/auth/refresh', {
    role,
    route: '/api/v2/auth/refresh',
    headers: csrfToken ? { 'X-HMS-CSRF': csrfToken } : {},
    expected: [200],
    tags: { auth_action: 'refresh' },
  });

  if (res.status !== 200) {
    return null;
  }

  const payload = safeJson(res);
  const token = payload && payload.data && payload.data.access_token;
  if (!token) return null;

  sessionRefreshes.add(1, { role });
  return {
    role,
    accessToken: token,
    csrfToken: readCsrfCookie() || csrfToken,
    lastAuthenticatedAt: Date.now(),
  };
}

function getJson(session, path, opts) {
  const res = request('GET', path, {
    role: opts.role,
    route: opts.route,
    session,
    metric: opts.metric,
    expected: opts.expected || [200],
  });
  return safeJson(res);
}

function postJson(session, path, body, opts) {
  const res = request('POST', path, {
    role: opts.role,
    route: opts.route,
    session,
    body,
    metric: opts.metric,
    expected: opts.expected || [200, 201],
  });
  return safeJson(res);
}

function request(method, path, opts) {
  const tags = {
    name: opts.route || path,
    hms_role: opts.role || 'unknown',
    hms_route: opts.route || path,
    ...(opts.tags || {}),
  };
  const headers = {
    'Content-Type': 'application/json',
    'X-Facility-Code': FACILITY_CODE,
    'X-Device-Label': 'k6-rust-v2-load-test',
    ...(opts.headers || {}),
  };

  if (opts.session && opts.session.accessToken) {
    headers.Authorization = `Bearer ${opts.session.accessToken}`;
    const csrfToken = readCsrfCookie() || opts.session.csrfToken;
    if (csrfToken) {
      headers['X-HMS-CSRF'] = csrfToken;
    }
  }

  const body = opts.body === undefined ? null : JSON.stringify(opts.body);
  const res = http.request(method, `${BASE_URL}${path}`, body, {
    headers,
    tags,
    timeout: REQUEST_TIMEOUT,
    responseCallback: opts.responseCallback,
  });

  if (opts.metric) {
    opts.metric.add(res.timings.duration, tags);
  }

  const expected = opts.expected || [200];
  const ok = expected.indexOf(res.status) !== -1;
  errors.add(!ok, tags);
  if (!ok) {
    failedRequests.add(1, tags);
    if (DEBUG_FAILURES) {
      console.error(`request failed method=${method} route=${tags.hms_route} role=${tags.hms_role} status=${res.status}`);
    }
  }

  check(res, {
    [`${method} ${tags.hms_route} expected status`]: () => ok,
  }, tags);

  return res;
}

function buildOptions() {
  const scenarios = {
    staff_workday: {
      executor: 'ramping-vus',
      exec: 'staffWorkday',
      gracefulRampDown: '30s',
      stages: profileStages(PROFILE),
    },
  };

  if (INCLUDE_OPD_RUSH) {
    scenarios.opd_rush = {
      executor: 'ramping-arrival-rate',
      exec: 'opdRush',
      startRate: positiveInt(__ENV.HMS_LOAD_OPD_START_RATE, 1),
      timeUnit: '1m',
      preAllocatedVUs: positiveInt(__ENV.HMS_LOAD_OPD_PREALLOCATED_VUS, 20),
      maxVUs: positiveInt(__ENV.HMS_LOAD_OPD_MAX_VUS, 200),
      gracefulStop: '30s',
      stages: [
        { duration: '2m', target: positiveInt(__ENV.HMS_LOAD_OPD_RAMP_RATE, 10) },
        { duration: __ENV.HMS_LOAD_OPD_HOLD_DURATION || '10m', target: positiveInt(__ENV.HMS_LOAD_OPD_HOLD_RATE, 20) },
        { duration: '2m', target: 0 },
      ],
    };
  }

  const thresholds = {
    hms_errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
    hms_auth_me: [p99(75)],
    hms_patient_list: [p99(200)],
  };

  if (workflowEnabled('doctor')) {
    thresholds.hms_patient_chronicle = [p99(300)];
    thresholds.hms_search = [p99(250)];
  }
  if (workflowEnabled('nurse')) {
    thresholds.hms_ward_board = [p99(250)];
  }
  if (workflowEnabled('lab')) {
    thresholds.hms_laboratory = [p99(300)];
  }
  if (workflowEnabled('pharmacy')) {
    thresholds.hms_inventory = [p99(300)];
  }
  if (workflowEnabled('billing')) {
    thresholds.hms_billing = [p99(500)];
  }
  if (ENABLE_WRITES) {
    thresholds.hms_clinical_write = [p99(500)];
    thresholds.hms_operational_write = [p99(500)];
  }

  return {
    scenarios,
    thresholds,
    tags: {
      hms_suite: 'rust-v2-realistic',
      hms_profile: PROFILE,
      hms_facility: FACILITY_CODE,
      hms_writes: ENABLE_WRITES ? 'enabled' : 'disabled',
    },
    summaryTrendStats: ['min', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
    systemTags: ['status', 'method', 'name', 'group', 'check', 'scenario', 'error', 'expected_response'],
  };
}

function profileStages(profile) {
  switch (profile) {
    case 'baseline':
      return [
        { duration: '2m', target: 25 },
        { duration: '15m', target: 25 },
        { duration: '2m', target: 0 },
      ];
    case 'small-site':
      return [
        { duration: '3m', target: 50 },
        { duration: '30m', target: 50 },
        { duration: '3m', target: 0 },
      ];
    case 'busy-site':
      return [
        { duration: '5m', target: 100 },
        { duration: '30m', target: 100 },
        { duration: '5m', target: 0 },
      ];
    case 'stress':
      return [
        { duration: '5m', target: 50 },
        { duration: '5m', target: 100 },
        { duration: '5m', target: 200 },
        { duration: '10m', target: 200 },
        { duration: '5m', target: 0 },
      ];
    case 'soak':
      return [
        { duration: '5m', target: 75 },
        { duration: __ENV.HMS_LOAD_SOAK_HOLD_DURATION || '1h', target: 75 },
        { duration: '5m', target: 0 },
      ];
    case 'smoke':
    default:
      return [
        { duration: '30s', target: 5 },
        { duration: '2m', target: 5 },
        { duration: '30s', target: 0 },
      ];
  }
}

function loadCredentials() {
  const sharedEmail = __ENV.HMS_LOAD_EMAIL || '';
  const sharedPassword = __ENV.HMS_LOAD_PASSWORD || __ENV.HMS_LOAD_TEST_PASSWORD || '';
  const credentials = {};

  for (const workflow of ALL_WORKFLOWS) {
    const key = workflow.toUpperCase().replace(/-/g, '_');
    const email = __ENV[`HMS_LOAD_${key}_EMAIL`] || sharedEmail;
    const password = __ENV[`HMS_LOAD_${key}_PASSWORD`] || sharedPassword;
    if (email && password) {
      credentials[workflow] = { email, password };
    }
  }

  if (Object.keys(credentials).length === 0) {
    throw new Error('Set HMS_LOAD_EMAIL/HMS_LOAD_PASSWORD or role-specific HMS_LOAD_<ROLE>_EMAIL/HMS_LOAD_<ROLE>_PASSWORD.');
  }

  return credentials;
}

function buildActiveRoles(credentials) {
  const enabled = WORKFLOW_FILTER.length > 0 ? WORKFLOW_FILTER : ALL_WORKFLOWS;
  return rolePlan
    .filter((item) => enabled.indexOf(item.role) !== -1)
    .filter((item) => credentials[item.role]);
}

function workflowEnabled(workflow) {
  return WORKFLOW_FILTER.length === 0 || WORKFLOW_FILTER.indexOf(workflow) !== -1;
}

function chooseRole(activeRoles) {
  const total = activeRoles.reduce((sum, item) => sum + item.weight, 0);
  let cursor = (__VU + __ITER + randomInt(0, total)) % total;
  for (const item of activeRoles) {
    if (cursor < item.weight) return item.role;
    cursor -= item.weight;
  }
  return activeRoles[0].role;
}

function readCsrfCookie() {
  const cookies = http.cookieJar().cookiesForURL(BASE_URL);
  const csrf = cookies.hms_v2_csrf;
  return Array.isArray(csrf) && csrf.length > 0 ? csrf[0] : '';
}

function safeJson(res) {
  if (!res || !res.body) return null;
  try {
    return JSON.parse(res.body);
  } catch (_) {
    return null;
  }
}

function listIds(payload) {
  if (!payload || !Array.isArray(payload.data)) return [];
  return payload.data.map((item) => item && item.id).filter(Boolean);
}

function objectId(payload) {
  return payload && payload.data && payload.data.id ? payload.data.id : null;
}

function qs(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

function p99(ms) {
  return `p(99)<${Math.round(ms * BUDGET_MULTIPLIER)}`;
}

function pick(items) {
  if (!items || items.length === 0) return null;
  return items[randomInt(0, items.length - 1)];
}

function randomChance(probability) {
  return Math.random() < probability;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max, decimals) {
  const value = Math.random() * (max - min) + min;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function think(minSeconds, maxSeconds) {
  const min = Math.max(0.1, minSeconds * THINK_TIME_SCALE);
  const max = Math.max(min, maxSeconds * THINK_TIME_SCALE);
  sleep(randomFloat(min, max, 2));
}

function safeSuffix(runId) {
  const vu = typeof __VU === 'undefined' ? 0 : __VU;
  const iter = typeof __ITER === 'undefined' ? 0 : __ITER;
  return `${runId}${vu}${iter}${randomInt(100, 999)}`
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(-12);
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].indexOf(String(value || '').toLowerCase()) !== -1;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveFloat(value, fallback) {
  const parsed = Number.parseFloat(String(value || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}
