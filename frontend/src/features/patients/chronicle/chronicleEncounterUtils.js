export function getEncounterKind(encounter) {
  const encounterType = encounter?.encounter_type || encounter?.type;
  return typeof encounterType === 'string' ? encounterType.toLowerCase() : null;
}

function isChronicleInpatientEncounterKind(encounter) {
  return ['inpatient', 'admission', 'emergency', 'hospitalization'].includes(getEncounterKind(encounter));
}

export function mergeRustV2Encounters(chronicleContext) {
  const encountersById = new Map();

  if (Array.isArray(chronicleContext?.encounters)) {
    chronicleContext.encounters.forEach((encounter) => {
      if (encounter?.id !== null && encounter?.id !== undefined) {
        encountersById.set(String(encounter.id), encounter);
      }
    });
  }

  if (chronicleContext?.active_encounter?.id !== null && chronicleContext?.active_encounter?.id !== undefined) {
    encountersById.set(String(chronicleContext.active_encounter.id), chronicleContext.active_encounter);
  }

  return Array.from(encountersById.values());
}

export function findActiveChronicleEncounter(encounters) {
  if (!encounters || encounters.length === 0) {
    return null;
  }

  const activeOutpatientVisitStatuses = new Set([
    'checked_in',
    'waiting',
    'called',
    'in_progress',
    'on_hold',
    'ready_checkout',
  ]);

  const activeInpatient = encounters.find((encounter) => (
    encounter.status === 'in-progress'
    && isChronicleInpatientEncounterKind(encounter)
  ));

  if (activeInpatient) {
    return activeInpatient;
  }

  const activeAny = encounters.find((encounter) => encounter.status === 'in-progress');
  if (activeAny) {
    return activeAny;
  }

  return encounters.find((encounter) => (
    (getEncounterKind(encounter) || 'outpatient') === 'outpatient'
    && encounter.status === 'planned'
    && activeOutpatientVisitStatuses.has(encounter.outpatient_visit_status)
  )) || null;
}

export function resolveChronicleActiveAdmission({ activeEncounter, rustV2ActiveAdmission }) {
  if (rustV2ActiveAdmission) {
    return rustV2ActiveAdmission;
  }

  if (activeEncounter && isChronicleInpatientEncounterKind(activeEncounter)) {
    return activeEncounter;
  }

  return null;
}
