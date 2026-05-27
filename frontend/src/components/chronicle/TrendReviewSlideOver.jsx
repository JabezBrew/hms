import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';

import { useFluidBalanceTrends, useVitalSignsTrends } from '@/features/nursing/hooks';
import { TrendReviewSlideOverPanel } from '@/components/chronicle/TrendReviewSlideOverSections';

function getPatientId(patient) {
  return patient?.local_data?.id || patient?.id || null;
}

function getPatientName(patient) {
  const firstName = patient?.local_data?.user_details?.first_name || patient?.user_details?.first_name || '';
  const lastName = patient?.local_data?.user_details?.last_name || patient?.user_details?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || patient?.name || 'Patient';
}

function formatScopeLabel({ allHistory, encounterId, admissionId }) {
  if (allHistory) {
    return 'All history';
  }
  if (encounterId) {
    return 'Visit scoped';
  }
  if (admissionId) {
    return 'Admission scoped';
  }
  return 'Patient scoped';
}

export default function TrendReviewSlideOver({
  open,
  onClose,
  patient,
  encounterId = null,
  admissionId = null,
  allHistory = false,
  initialTab = 'vitals',
}) {
  if (!open) {
    return null;
  }

  const patientId = getPatientId(patient);
  const showFluidTab = allHistory || Boolean(admissionId);
  const resolvedInitialTab = showFluidTab ? initialTab : 'vitals';
  const scopeKey = [
    patientId || 'patient',
    encounterId || 'no-encounter',
    admissionId || 'no-admission',
    allHistory ? 'all-history' : 'scoped',
    resolvedInitialTab,
  ].join(':');

  return (
    <TrendReviewSlideOverContent
      key={scopeKey}
      admissionId={admissionId}
      allHistory={allHistory}
      encounterId={encounterId}
      initialTab={resolvedInitialTab}
      onClose={onClose}
      patient={patient}
      patientId={patientId}
      showFluidTab={showFluidTab}
    />
  );
}

function TrendReviewSlideOverContent({
  admissionId,
  allHistory,
  encounterId,
  initialTab,
  onClose,
  patient,
  patientId,
  showFluidTab,
}) {
  const patientName = getPatientName(patient);
  const [activeTab, setActiveTab] = useState(initialTab);

  const vitalsFilters = useMemo(() => {
    if (allHistory) {
      return {};
    }
    if (encounterId) {
      return { encounter_id: encounterId };
    }
    if (admissionId) {
      return { admission_id: admissionId };
    }
    return {};
  }, [admissionId, allHistory, encounterId]);

  const fluidFilters = useMemo(() => {
    if (allHistory || !admissionId) {
      return {};
    }
    return { admission_id: admissionId };
  }, [admissionId, allHistory]);

  const {
    data: vitalsData = [],
    isLoading: vitalsLoading,
  } = useVitalSignsTrends(patientId, vitalsFilters, {
    enabled: !!patientId,
  });

  const {
    data: fluidTrendData = [],
    isLoading: fluidLoading,
  } = useFluidBalanceTrends(patientId, fluidFilters, {
    enabled: !!patientId && (allHistory || !!admissionId),
  });

  const formattedVitals = useMemo(() => (
    vitalsData
      .flatMap((entry) => {
        const recordedAt = entry.recorded_at ? new Date(entry.recorded_at) : null;
        const timestamp = recordedAt ? recordedAt.getTime() : Number.NaN;

        if (!Number.isFinite(timestamp)) {
          return [];
        }

        return [{
          timestamp,
          time: format(recordedAt, 'HH:mm'),
          date: format(recordedAt, 'MMM d'),
          temperature: entry.temperature == null ? null : Number(entry.temperature),
          heartRate: entry.heart_rate == null ? null : Number(entry.heart_rate),
          systolic: entry.blood_pressure_systolic == null ? null : Number(entry.blood_pressure_systolic),
          diastolic: entry.blood_pressure_diastolic == null ? null : Number(entry.blood_pressure_diastolic),
          respiratoryRate: entry.respiratory_rate == null ? null : Number(entry.respiratory_rate),
          oxygenSaturation: entry.oxygen_saturation == null ? null : Number(entry.oxygen_saturation),
          painLevel: entry.pain_level == null ? null : Number(entry.pain_level),
        }];
      })
      .sort((left, right) => left.timestamp - right.timestamp)
  ), [vitalsData]);

  const latestVitals = formattedVitals[formattedVitals.length - 1] || null;

  const formattedFluidTrendData = useMemo(() => (
    fluidTrendData
      .flatMap((point) => {
        const parsedDate = typeof point.date === 'string' ? parseISO(point.date) : new Date(point.date);
        const timestamp = parsedDate?.getTime?.() ?? Number.NaN;

        if (!Number.isFinite(timestamp)) {
          return [];
        }

        return [{
          ...point,
          timestamp,
          dateLabel: format(parsedDate, 'MMM d'),
          fullDateLabel: format(parsedDate, 'MMM d, yyyy'),
        }];
      })
      .sort((left, right) => left.timestamp - right.timestamp)
  ), [fluidTrendData]);

  const fluidSummary = useMemo(() => (
    formattedFluidTrendData.reduce((acc, point) => ({
      totalIntake: acc.totalIntake + Number(point.intake || 0),
      totalOutput: acc.totalOutput + Number(point.output || 0),
      totalBalance: acc.totalBalance + Number(point.balance || 0),
    }), { totalIntake: 0, totalOutput: 0, totalBalance: 0 })
  ), [formattedFluidTrendData]);

  const latestFluidPoint = formattedFluidTrendData[formattedFluidTrendData.length - 1] || null;
  const scopeLabel = formatScopeLabel({ allHistory, encounterId, admissionId });

  return (
    <TrendReviewSlideOverPanel
      activeTab={activeTab}
      admissionId={admissionId}
      allHistory={allHistory}
      encounterId={encounterId}
      fluidLoading={fluidLoading}
      fluidSummary={fluidSummary}
      formattedFluidTrendData={formattedFluidTrendData}
      formattedVitals={formattedVitals}
      latestFluidPoint={latestFluidPoint}
      latestVitals={latestVitals}
      onClose={onClose}
      onTabChange={setActiveTab}
      patientName={patientName}
      scopeLabel={scopeLabel}
      showFluidTab={showFluidTab}
      vitalsLoading={vitalsLoading}
    />
  );
}
