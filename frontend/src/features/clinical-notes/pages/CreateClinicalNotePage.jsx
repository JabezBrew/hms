import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useEncounter } from '@/features/encounters/hooks/useEncounterQueries';
import { useAuth } from '@/lib/auth';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { 
  useNoteEntriesForEncounter, 
  useActiveNoteTemplates,
  useCreateNoteTemplate 
} from '@/features/clinical-notes/hooks';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import TemplateSelector from '@/components/clinical-notes/TemplateSelector';
import DynamicNoteForm from '@/components/clinical-notes/DynamicNoteForm';
import TemplateBuilder from '@/components/clinical-notes/TemplateBuilder';
import { CLINICAL_NOTE_TYPES } from '@/features/clinical-notes/noteTypes';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { useUrlEnumParam } from '@/shared/hooks/useUrlEnumParam';

const DEFAULT_NURSING_TEMPLATE_TITLES = ['Nursing Vitals', 'Nursing I/O', 'Nursing Meds', 'Nursing Note'];
const CLINICAL_NOTE_TABS = ['new', 'history', 'template'];

const DEFAULT_NURSING_TEMPLATES = [
  {
    title: 'Nursing Vitals',
    description: 'Template for recording patient vital signs',
    note_type: CLINICAL_NOTE_TYPES.NURSING,
    is_active: true,
    is_public: true,
    is_default: true,
    structure: [
      { section: 'Vitals', type: 'observation', observation_type: 'vitals' },
      { section: 'Notes', type: 'text' },
    ],
  },
  {
    title: 'Nursing I/O',
    description: 'Template for recording fluid intake and output',
    note_type: CLINICAL_NOTE_TYPES.NURSING,
    is_active: true,
    is_public: true,
    is_default: true,
    structure: [
      { section: 'I/O Chart', type: 'observation', observation_type: 'fluid_balance' },
      { section: 'Notes', type: 'text' },
    ],
  },
  {
    title: 'Nursing Meds',
    description: 'Template for recording medications administered',
    note_type: CLINICAL_NOTE_TYPES.NURSING,
    is_active: true,
    is_public: true,
    is_default: true,
    structure: [
      { section: 'Medication Given', type: 'medication_administration' },
      { section: 'Notes', type: 'text' },
    ],
  },
  {
    title: 'Nursing Note',
    description: 'Template for general nursing notes',
    note_type: CLINICAL_NOTE_TYPES.NURSING,
    is_active: true,
    is_public: true,
    is_default: true,
    structure: [{ section: 'Nurse Note', type: 'text' }],
  },
];

const NURSING_ACTIVITIES = [
  {
    title: 'Vitals Chart',
    description: 'Record patient vital signs',
    templateNeedle: 'nursing vitals',
    missingMessage: 'Please create a Nursing Vitals template first',
  },
  {
    title: 'I/O Chart',
    description: 'Record fluid intake and output',
    templateNeedle: 'nursing i/o',
    missingMessage: 'Please create a Nursing I/O template first',
  },
  {
    title: 'Medications',
    description: 'Record medications administered',
    templateNeedle: 'nursing meds',
    missingMessage: 'Please create a Nursing Meds template first',
  },
  {
    title: 'Nurse Note',
    description: 'Record general nursing notes',
    templateNeedle: 'nursing note',
    missingMessage: 'Please create a Nursing Note template first',
  },
];

function ClinicalNotePageState({
  isErrorEncounter,
  isEncounterValid,
  isLoadingEncounter,
  encounterStatus,
  children,
}) {
  if (isLoadingEncounter) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading encounter details…</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (isErrorEncounter) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          Failed to load encounter details. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  if (!isEncounterValid) {
    return (
      <Alert>
        <AlertCircle className="size-4" />
        <AlertTitle>Note</AlertTitle>
        <AlertDescription>
          Clinical notes can only be added to active or planned encounters.
          This encounter is currently marked as {encounterStatus}.
        </AlertDescription>
      </Alert>
    );
  }

  return children;
}

function ClinicalNotesTabs({
  activeTab,
  existingNotes,
  encounterId,
  isErrorNotes,
  isLoadingNotes,
  isNurse,
  onChangeTemplate,
  onCreateTemplateSuccess,
  onFormSuccess,
  onSelectNursingActivity,
  onSelectTemplate,
  patientId,
  rustV2Mode,
  selectedTemplate,
  setActiveTab,
}) {
  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="new">New Note</TabsTrigger>
        <TabsTrigger value="history">Note History</TabsTrigger>
        <TabsTrigger value="template">Create Template</TabsTrigger>
      </TabsList>

      <TabsContent value="new" className="space-y-4">
        <NewNoteTab
          encounterId={encounterId}
          isNurse={isNurse}
          onChangeTemplate={onChangeTemplate}
          onFormSuccess={onFormSuccess}
          onSelectNursingActivity={onSelectNursingActivity}
          onSelectTemplate={onSelectTemplate}
          patientId={patientId}
          selectedTemplate={selectedTemplate}
        />
      </TabsContent>

      <TabsContent value="template" className="space-y-4">
        <TemplateBuilder onSuccess={onCreateTemplateSuccess} />
      </TabsContent>

      <TabsContent value="form" className="space-y-4">
        {selectedTemplate ? (
          <DynamicNoteForm
            template={selectedTemplate}
            encounterId={encounterId}
            patientId={patientId}
            onSuccess={onFormSuccess}
          />
        ) : null}
      </TabsContent>

      <TabsContent value="history">
        <ClinicalNoteHistoryTab
          existingNotes={existingNotes}
          isErrorNotes={isErrorNotes}
          isLoadingNotes={isLoadingNotes}
          rustV2Mode={rustV2Mode}
        />
      </TabsContent>
    </Tabs>
  );
}

function NewNoteTab({
  encounterId,
  isNurse,
  onChangeTemplate,
  onFormSuccess,
  onSelectNursingActivity,
  onSelectTemplate,
  patientId,
  selectedTemplate,
}) {
  if (!selectedTemplate) {
    return (
      <div className="space-y-6">
        {isNurse ? <NursingActivitiesCard onSelectActivity={onSelectNursingActivity} /> : null}
        <TemplateSelector onSelectTemplate={onSelectTemplate} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Create Note</h2>
        <Button variant="outline" onClick={onChangeTemplate}>
          Change Template
        </Button>
      </div>
      <DynamicNoteForm
        template={selectedTemplate}
        encounterId={encounterId}
        patientId={patientId}
        onSuccess={onFormSuccess}
      />
    </div>
  );
}

function NursingActivitiesCard({ onSelectActivity }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nursing Activities</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <p className="text-muted-foreground">
            Select the nursing activity you want to record. Each activity is tracked separately for better time management.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {NURSING_ACTIVITIES.map((activity) => (
            <NursingActivityButton
              key={activity.title}
              activity={activity}
              onSelectActivity={onSelectActivity}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function NursingActivityButton({ activity, onSelectActivity }) {
  return (
    <button
      type="button"
      className="rounded-lg border bg-card text-card-foreground text-left shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={() => onSelectActivity(activity)}
    >
      <div className="p-6 pb-2">
        <h3 className="text-lg font-semibold leading-none tracking-tight">{activity.title}</h3>
      </div>
      <div className="p-6 pt-0">
        <p className="text-sm text-muted-foreground">{activity.description}</p>
      </div>
    </button>
  );
}

function ClinicalNoteHistoryTab({ existingNotes, isErrorNotes, isLoadingNotes, rustV2Mode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{rustV2Mode ? 'Patient Note History' : 'Note History'}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoadingNotes ? (
          <p>Loading notes…</p>
        ) : isErrorNotes ? (
          <p className="text-red-500">Failed to load notes. Please try again later.</p>
        ) : !existingNotes || existingNotes.length === 0 ? (
          <p>
            {rustV2Mode
              ? 'No clinical notes have been created for this patient yet.'
              : 'No notes have been created for this encounter yet.'}
          </p>
        ) : (
          <div className="space-y-4">
            {existingNotes.map((note) => (
              <ClinicalNoteHistoryCard key={note.id} note={note} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ClinicalNoteHistoryCard({ note }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{note.template_title || note.title || 'Clinical note'}</CardTitle>
        <p className="text-sm text-muted-foreground">
          Created: {new Date(note.created_at).toLocaleString()}
        </p>
        {(note.practitioner_name || note.created_by_name) ? (
          <p className="text-sm text-muted-foreground">
            By: {note.practitioner_name || note.created_by_name}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {Object.entries(note.data || {}).map(([section, data]) => (
            <div key={section}>
              <h4 className="font-medium">{section}</h4>
              {typeof data === 'string' ? (
                <p>{data}</p>
              ) : (
                <pre className="text-sm bg-muted p-2 rounded">
                  {JSON.stringify(data, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CreateClinicalNotePage() {
  const { id: encounterId } = useParams();
  const navigate = useNavigate();
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [activeTab, setActiveTab] = useUrlEnumParam({
    param: 'tab',
    values: CLINICAL_NOTE_TABS,
    defaultValue: 'new',
  });
  const [isTemplateFormActive, setIsTemplateFormActive] = useState(false);
  const isCreatingTemplatesRef = useRef(false);
  const rustV2Mode = isRustV2ApiMode();

  // Get the user's authentication information
  const { user } = useAuth();
  const userRole = user?.role || user?.user_type;
  const isNurse = ['nurse', 'head_nurse', 'nurse_practitioner'].includes(userRole);

  // Get the create template mutation
  const createNoteTemplate = useCreateNoteTemplate();

  // Fetch encounter data
  const { 
    data: encounter, 
    isLoading: isLoadingEncounter, 
    isError: isErrorEncounter,
    error: encounterError
  } = useEncounter(encounterId);

  const encounterPatientId = encounter?.patient_id || encounter?.patient?.id || encounter?.patient || null;

  // Fetch existing notes for this encounter
  const {
    data: existingNotes,
    isLoading: isLoadingNotes,
    isError: isErrorNotes
  } = useNoteEntriesForEncounter(encounterId, {
    page_size: 200,
    ...(encounterPatientId ? { patient_id: encounterPatientId } : {}),
    enabled: rustV2Mode ? !!encounterPatientId : true,
  });

  // Fetch all active templates
  const {
    data: activeTemplates,
    isLoading: isLoadingTemplates,
  } = useActiveNoteTemplates({ page_size: 200 });

  const encounterLabel = encounter?.patient_name
    ? `Encounter for ${encounter.patient_name}`
    : `Encounter ${encounterId}`;

  const pageMeta = usePageMeta({
    title: encounter?.patient_name
      ? `Clinical Notes · ${encounter.patient_name} | HMS`
      : 'Clinical Notes | HMS',
    breadcrumbs: [
      { label: 'Encounters', href: '/encounters' },
      { label: encounterLabel, href: `/encounters/${encounterId}` },
      { label: 'Clinical Notes', href: `/encounters/${encounterId}/clinical-notes` },
    ],
  });

  // Show error toast if encounter query fails
  useEffect(() => {
    if (isErrorEncounter) {
      toast.error(encounterError?.message || 'Failed to load encounter details');
      console.error('Error loading encounter:', encounterError);
    }
  }, [isErrorEncounter, encounterError]);

  // Create default nursing templates
  const createDefaultNursingTemplates = useCallback(async () => {
    try {
      isCreatingTemplatesRef.current = true;
      await Promise.all(DEFAULT_NURSING_TEMPLATES.map((template) => createNoteTemplate.mutateAsync(template)));

      toast.success('Default nursing templates created successfully');
    } catch {
      toast.error('Failed to create default nursing templates');
    } finally {
      isCreatingTemplatesRef.current = false;
    }
  }, [createNoteTemplate]);

  // Automatically create default nursing templates for nurses
  useEffect(() => {
    // Only proceed if user is a nurse and templates are loaded and not already creating templates
    if (isNurse && !isLoadingTemplates && activeTemplates && !isCreatingTemplatesRef.current) {
      // Check if all default nursing templates already exist (exact title match)
      const existingTitles = activeTemplates.map(template => template.title);
      const missingTemplates = DEFAULT_NURSING_TEMPLATE_TITLES.filter(title => !existingTitles.includes(title));

      // Only create templates if any are missing
      if (missingTemplates.length > 0) {
        createDefaultNursingTemplates();
      }
    }
  }, [isNurse, isLoadingTemplates, activeTemplates, createDefaultNursingTemplates]);

  // Handle template selection
  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    setIsTemplateFormActive(true);
  };

  const handleSelectNursingActivity = (activity) => {
    const matchingTemplate = activeTemplates?.find(template =>
      template.title.toLowerCase().includes(activity.templateNeedle)
    );

    if (matchingTemplate) {
      handleSelectTemplate(matchingTemplate);
    } else {
      toast.info(activity.missingMessage);
    }
  };

  // Handle form submission success
  const handleFormSuccess = () => {
    // Reset the form
    setSelectedTemplate(null);
    setIsTemplateFormActive(false);
    setActiveTab('new');

    // Navigate back to the encounter detail page
    navigate(`/encounters/${encounterId}`);
  };

  // Handle template creation success
  const handleTemplateCreationSuccess = () => {
    toast.success('Template created successfully. You can now select it from the template list.');
  };

  const handleVisibleTabChange = (nextTab) => {
    setIsTemplateFormActive(false);
    setActiveTab(nextTab);
  };

  // Check if encounter is valid for adding notes
  const isEncounterValid = encounter && 
    (encounter.status === 'in-progress' || encounter.status === 'planned');

  const encounterDate = encounter?.start_time
    ? new Date(encounter.start_time).toLocaleDateString()
    : null;
  const headerDescription = encounter
    ? `${encounter.patient_name || 'Patient'}${encounterDate ? ` · ${encounterDate}` : ''}`
    : 'Create and manage clinical notes';

  return (
    <PageShell>
      {pageMeta}
        <PageHeader
          title="Clinical Notes"
          description={headerDescription}
          actions={(
            <Button
              variant="outline"
              onClick={() => navigate(`/encounters/${encounterId}`)}
            >
              Back to Encounter
            </Button>
          )}
          contentClassName="max-w-5xl mx-auto w-full"
        />

        <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
          <ClinicalNotePageState
            encounterStatus={encounter?.status}
            isEncounterValid={isEncounterValid}
            isErrorEncounter={isErrorEncounter}
            isLoadingEncounter={isLoadingEncounter}
          >
            <ClinicalNotesTabs
              encounterId={encounterId}
              existingNotes={existingNotes}
              isErrorNotes={isErrorNotes}
              isLoadingNotes={isLoadingNotes}
              isNurse={isNurse}
              onChangeTemplate={() => setSelectedTemplate(null)}
              onCreateTemplateSuccess={handleTemplateCreationSuccess}
              onFormSuccess={handleFormSuccess}
              onSelectNursingActivity={handleSelectNursingActivity}
              onSelectTemplate={handleSelectTemplate}
              patientId={encounter?.patient}
              rustV2Mode={rustV2Mode}
              selectedTemplate={selectedTemplate}
              activeTab={isTemplateFormActive ? 'form' : activeTab}
              setActiveTab={handleVisibleTabChange}
            />
          </ClinicalNotePageState>
      </div>
    </PageShell>
  );
}
