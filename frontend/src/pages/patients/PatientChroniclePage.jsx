import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { usePatient } from "@/hooks/usePatientQueries";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PatientIdentityHero,
  ClinicalSummarySidebar,
  TimelineEntry,
  TimelineGroup
} from "@/components/chronicle";
import {
  Clock,
  FileText,
  Pill,
  TestTube,
  Activity,
  Filter,
  RefreshCw
} from "lucide-react";

/**
 * PatientChroniclePage - Magazine-style patient health record view
 *
 * Layout:
 * - Hero header with patient identity
 * - Two-column layout: Clinical Summary | Timeline Chronicle
 * - Timeline with filterable entries
 */
const PatientChroniclePage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState('all');

  // Fetch patient data
  const { data: patient, isLoading, error, refetch } = usePatient(id);

  // ============================================
  // Mock timeline data (replace with real API)
  // ============================================

  const timelineEntries = useMemo(() => {
    // This would come from an API call in production
    return [
      {
        id: 1,
        type: 'progress_note',
        timestamp: new Date().toISOString(),
        title: 'Morning Assessment',
        content: 'Patient remains stable. Vital signs within normal limits. Continue current management plan. Will reassess in the afternoon. Pain level reported as 3/10, down from 5/10 yesterday. Appetite improving. Ambulated twice today with assistance.',
        author: 'Dr. M. Chen'
      },
      {
        id: 2,
        type: 'vitals',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        data: {
          temperature: '98.6',
          blood_pressure: '128/82',
          heart_rate: '72',
          spo2: '97',
          respiratory_rate: '16'
        },
        author: 'RN J. Smith'
      },
      {
        id: 3,
        type: 'medication',
        timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
        data: {
          name: 'Metoprolol',
          dose: '50mg',
          route: 'PO',
          frequency: 'BID'
        },
        author: 'RN J. Smith'
      },
      {
        id: 4,
        type: 'lab_result',
        timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        data: {
          test_name: 'Troponin I',
          value: '0.04',
          unit: 'ng/mL',
          reference_range: '<0.04',
          is_abnormal: false
        },
        author: 'Lab'
      },
      {
        id: 5,
        type: 'consult',
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        title: 'Cardiology Consultation',
        content: 'Consulted for evaluation of chest pain. Recommend continued monitoring. Consider stress test if symptoms persist. Will follow.',
        author: 'Dr. A. Patel, Cardiology'
      },
      {
        id: 6,
        type: 'vitals',
        timestamp: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
        data: {
          temperature: '99.1',
          blood_pressure: '142/88',
          heart_rate: '88',
          spo2: '94',
          respiratory_rate: '18'
        },
        author: 'RN K. Williams'
      },
      {
        id: 7,
        type: 'admission',
        timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        title: 'Admission',
        content: 'Admitted for evaluation of chest pain. Initial workup ordered including ECG, troponins, and chest X-ray.',
        author: 'Dr. M. Chen'
      }
    ];
  }, []);

  // Mock clinical data
  const problems = useMemo(() => [
    { id: 1, name: 'Chest pain, unspecified', severity: 'high', is_primary: true },
    { id: 2, name: 'Hypertension', severity: 'medium', is_chronic: true, duration: '5 years' },
    { id: 3, name: 'Type 2 Diabetes', severity: 'medium', is_chronic: true, duration: '3 years' },
    { id: 4, name: 'Hyperlipidemia', severity: 'low', is_chronic: true }
  ], []);

  const medications = useMemo(() => [
    { id: 1, name: 'Metoprolol', dose: '50mg', frequency: 'BID' },
    { id: 2, name: 'Lisinopril', dose: '10mg', frequency: 'Daily' },
    { id: 3, name: 'Metformin', dose: '1000mg', frequency: 'BID' },
    { id: 4, name: 'Atorvastatin', dose: '40mg', frequency: 'QHS' },
    { id: 5, name: 'Aspirin', dose: '81mg', frequency: 'Daily' },
    { id: 6, name: 'Heparin', dose: '5000u', frequency: 'Q8H' }
  ], []);

  const allergies = useMemo(() => [
    { name: 'Penicillin', severity: 'severe' },
    { name: 'Sulfa drugs', severity: 'moderate' }
  ], []);

  const labResults = useMemo(() => [
    { id: 1, name: 'K+', value: '4.2', unit: 'mEq/L', is_abnormal: false },
    { id: 2, name: 'Na+', value: '138', unit: 'mEq/L', is_abnormal: false },
    { id: 3, name: 'Cr', value: '1.8', unit: 'mg/dL', is_abnormal: true, abnormal_direction: 'high' },
    { id: 4, name: 'Glucose', value: '142', unit: 'mg/dL', is_abnormal: true, abnormal_direction: 'high' }
  ], []);

  // ============================================
  // Filter entries
  // ============================================

  const filteredEntries = useMemo(() => {
    if (activeFilter === 'all') return timelineEntries;
    return timelineEntries.filter(entry => entry.type === activeFilter);
  }, [timelineEntries, activeFilter]);

  // Group entries by date
  const groupedEntries = useMemo(() => {
    const groups = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();

    filteredEntries.forEach(entry => {
      const entryDate = new Date(entry.timestamp).toDateString();
      let dateLabel;

      if (entryDate === today) {
        dateLabel = 'Today';
      } else if (entryDate === yesterday) {
        dateLabel = 'Yesterday';
      } else {
        dateLabel = new Date(entry.timestamp).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric'
        });
      }

      if (!groups[dateLabel]) {
        groups[dateLabel] = [];
      }
      groups[dateLabel].push(entry);
    });

    return groups;
  }, [filteredEntries]);

  // ============================================
  // Event handlers
  // ============================================

  const handleAddNote = () => {
    navigate(`/encounters/create?patient=${id}`);
  };

  const handleRecordVitals = () => {
    // Navigate to vitals recording or open modal
    console.log('Record vitals');
  };

  const handlePrescribe = () => {
    // Navigate to prescribing workflow or open modal
    console.log('Prescribe');
  };

  // ============================================
  // Loading state
  // ============================================

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        {/* Hero skeleton */}
        <div className="bg-card border-b border-border px-6 py-8">
          <Skeleton className="h-12 w-64 mb-4" />
          <Skeleton className="h-4 w-96 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>

        {/* Content skeleton */}
        <div className="flex">
          <div className="w-80 border-r border-border p-6 space-y-6">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="flex-1 p-6 space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // Error state
  // ============================================

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-display text-foreground">
            Unable to load patient record
          </h2>
          <p className="text-muted-foreground">
            {error.message || 'An error occurred while fetching patient data.'}
          </p>
          <Button onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // ============================================
  // Render
  // ============================================

  return (
    <div className="min-h-screen bg-background">
      {/* Patient Identity Hero */}
      <PatientIdentityHero
        patient={patient}
        onAddNote={handleAddNote}
        onRecordVitals={handleRecordVitals}
        onPrescribe={handlePrescribe}
      />

      {/* Main Content: Sidebar + Timeline */}
      <div className="flex">
        {/* Clinical Summary Sidebar */}
        <ClinicalSummarySidebar
          patient={patient}
          problems={problems}
          medications={medications}
          allergies={allergies}
          labResults={labResults}
          className="hidden lg:block"
        />

        {/* Timeline Chronicle */}
        <main className="flex-1 p-6">
          {/* Timeline Header with Filters */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <h2 className="font-display text-2xl text-foreground">
                Clinical Chronicle
              </h2>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <div className="flex bg-muted rounded-lg p-1">
                {[
                  { key: 'all', label: 'All', icon: null },
                  { key: 'progress_note', label: 'Notes', icon: FileText },
                  { key: 'vitals', label: 'Vitals', icon: Activity },
                  { key: 'medication', label: 'Meds', icon: Pill },
                  { key: 'lab_result', label: 'Labs', icon: TestTube }
                ].map(filter => (
                  <button
                    key={filter.key}
                    onClick={() => setActiveFilter(filter.key)}
                    className={cn(
                      "px-3 py-1.5 rounded-md font-mono text-xs transition-colors",
                      "flex items-center gap-1.5",
                      activeFilter === filter.key
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {filter.icon && <filter.icon className="h-3 w-3" />}
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Timeline Entries */}
          <div className="relative">
            {Object.entries(groupedEntries).map(([date, entries], groupIndex) => (
              <TimelineGroup
                key={date}
                date={date}
                entries={entries}
                startIndex={groupIndex * 10}
              />
            ))}

            {filteredEntries.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p className="font-mono text-sm">No entries found</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default PatientChroniclePage;
