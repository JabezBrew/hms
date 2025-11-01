import { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, useParams } from 'react-router-dom';
import { useBreadcrumb } from '@/components/layout/PageBreadcrumb';
import { useEncounter } from '@/hooks/useEncounterQueries';
import { useAuth } from '@/lib/auth';
import { 
  useNoteEntriesForEncounter, 
  useActiveNoteTemplates,
  useCreateNoteTemplate 
} from '@/hooks/useClinicalNotesQueries';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import TemplateSelector from '@/components/clinical-notes/TemplateSelector';
import DynamicNoteForm from '@/components/clinical-notes/DynamicNoteForm';
import TemplateBuilder from '@/components/clinical-notes/TemplateBuilder';

export default function CreateClinicalNotePage() {
  const { id: encounterId } = useParams();
  const navigate = useNavigate();
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [activeTab, setActiveTab] = useState('new');
  const [showTemplateBuilder, setShowTemplateBuilder] = useState(false);
  const [isCreatingTemplates, setIsCreatingTemplates] = useState(false);

  // Get the user's authentication information
  const { user } = useAuth();
  const isNurse = user?.role === 'nurse';

  // Get the create template mutation
  const createNoteTemplate = useCreateNoteTemplate();

  // Fetch encounter data
  const { 
    data: encounter, 
    isLoading: isLoadingEncounter, 
    isError: isErrorEncounter,
    error: encounterError
  } = useEncounter(encounterId);

  // Fetch existing notes for this encounter
  const {
    data: existingNotes,
    isLoading: isLoadingNotes,
    isError: isErrorNotes
  } = useNoteEntriesForEncounter(encounterId);

  // Fetch all active templates
  const {
    data: activeTemplates,
    isLoading: isLoadingTemplates,
    isError: isErrorTemplates
  } = useActiveNoteTemplates();

  // Set breadcrumb
  const { updateBreadcrumbs } = useBreadcrumb();

  // Update breadcrumbs when data is loaded
  useEffect(() => {
    if (encounter) {
      updateBreadcrumbs([
        { label: 'Encounters', path: '/encounters' },
        { 
          label: encounter.patient_name 
            ? `Encounter for ${encounter.patient_name}` 
            : `Encounter ${encounterId}`, 
          path: `/encounters/${encounterId}` 
        },
        { label: 'Clinical Notes', path: `/encounters/${encounterId}/clinical-notes` }
      ]);
    } else {
      updateBreadcrumbs([
        { label: 'Encounters', path: '/encounters' },
        { label: 'Encounter Details', path: `/encounters/${encounterId}` },
        { label: 'Clinical Notes', path: `/encounters/${encounterId}/clinical-notes` }
      ]);
    }
  }, [encounter, encounterId, updateBreadcrumbs]);

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
      setIsCreatingTemplates(true);

      // Define the templates
      const nursingTemplates = [
        {
          title: 'Nursing Vitals',
          description: 'Template for recording patient vital signs',
          is_active: true,
          is_public: true,
          is_default: true,
          structure: [
            { section: 'Vitals', type: 'observation', observation_type: 'vitals' },
            { section: 'Notes', type: 'text' }
          ]
        },
        {
          title: 'Nursing I/O',
          description: 'Template for recording fluid intake and output',
          is_active: true,
          is_public: true,
          is_default: true,
          structure: [
            { section: 'I/O Chart', type: 'observation', observation_type: 'fluid_balance' },
            { section: 'Notes', type: 'text' }
          ]
        },
        {
          title: 'Nursing Meds',
          description: 'Template for recording medications administered',
          is_active: true,
          is_public: true,
          is_default: true,
          structure: [
            { section: 'Medication Given', type: 'medication_administration' },
            { section: 'Notes', type: 'text' }
          ]
        },
        {
          title: 'Nursing Note',
          description: 'Template for general nursing notes',
          is_active: true,
          is_public: true,
          is_default: true,
          structure: [
            { section: 'Nurse Note', type: 'text' }
          ]
        }
      ];

      // Create each template
      for (const template of nursingTemplates) {
        await createNoteTemplate.mutateAsync(template);
      }

      toast.success('Default nursing templates created successfully');
    } catch (error) {
      toast.error('Failed to create default nursing templates');
      console.error('Error creating templates:', error);
    } finally {
      setIsCreatingTemplates(false);
    }
  }, [createNoteTemplate]);

  // Automatically create default nursing templates for nurses
  useEffect(() => {
    // Only proceed if user is a nurse and templates are loaded and not already creating templates
    if (isNurse && !isLoadingTemplates && activeTemplates && !isCreatingTemplates) {
      // Get exact template titles to check
      const exactTitles = ['Nursing Vitals', 'Nursing I/O', 'Nursing Meds', 'Nursing Note'];

      // Check if all default nursing templates already exist (exact title match)
      const existingTitles = activeTemplates.map(template => template.title);
      const missingTemplates = exactTitles.filter(title => !existingTitles.includes(title));

      // Only create templates if any are missing
      if (missingTemplates.length > 0) {
        console.log('Creating missing nursing templates:', missingTemplates);
        createDefaultNursingTemplates();
      }
    }
  }, [isNurse, isLoadingTemplates, activeTemplates, createDefaultNursingTemplates, isCreatingTemplates]);

  // Handle template selection
  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    setActiveTab('form');
    setShowTemplateBuilder(false);
  };

  // Handle form submission success
  const handleFormSuccess = () => {
    // Reset the form
    setSelectedTemplate(null);
    setActiveTab('new');
    setShowTemplateBuilder(false);

    // Navigate back to the encounter detail page
    navigate(`/encounters/${encounterId}`);
  };

  // Handle template creation success
  const handleTemplateCreationSuccess = () => {
    toast.success('Template created successfully. You can now select it from the template list.');
    setShowTemplateBuilder(false);
  };


  // Check if encounter is valid for adding notes
  const isEncounterValid = encounter && 
    (encounter.status === 'in-progress' || encounter.status === 'planned');

  return (
    <>
      <Helmet>
        <title>
          {encounter 
            ? `Clinical Notes for ${encounter.patient_name || 'Patient'} | HMS` 
            : 'Clinical Notes | HMS'}
        </title>
        <meta name="description" content="Create and manage clinical notes" />
      </Helmet>

      <div className="container mx-auto py-6 space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Clinical Notes</h1>
            {encounter && (
              <p className="text-muted-foreground">
                {encounter.patient_name} - {new Date(encounter.start_time).toLocaleDateString()}
              </p>
            )}
          </div>

          <Button 
            variant="outline" 
            onClick={() => navigate(`/encounters/${encounterId}`)}
          >
            Back to Encounter
          </Button>
        </div>

        <Separator />

        {isLoadingEncounter ? (
          <Card>
            <CardHeader>
              <CardTitle>Loading encounter details...</CardTitle>
            </CardHeader>
          </Card>
        ) : isErrorEncounter ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              Failed to load encounter details. Please try again later.
            </AlertDescription>
          </Alert>
        ) : !isEncounterValid ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Note</AlertTitle>
            <AlertDescription>
              Clinical notes can only be added to active or planned encounters.
              This encounter is currently marked as {encounter?.status}.
            </AlertDescription>
          </Alert>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="new">New Note</TabsTrigger>
              <TabsTrigger value="history">Note History</TabsTrigger>
              <TabsTrigger value="template">Create Template</TabsTrigger>
            </TabsList>

            <TabsContent value="new" className="space-y-4">
              {!selectedTemplate ? (
                <div className="space-y-6">
                  {isNurse && (
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
                          <Card className="cursor-pointer hover:bg-accent" onClick={() => {
                            // Find the nursing vitals template
                            const vitalsTemplate = activeTemplates?.find(template => 
                              template.title.toLowerCase().includes('nursing vitals')
                            );
                            if (vitalsTemplate) {
                              handleSelectTemplate(vitalsTemplate);
                            } else {
                              toast.info("Please create a Nursing Vitals template first");
                            }
                          }}>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-lg">Vitals Chart</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <p className="text-sm text-muted-foreground">Record patient vital signs</p>
                            </CardContent>
                          </Card>

                          <Card className="cursor-pointer hover:bg-accent" onClick={() => {
                            // Find the nursing I/O template
                            const ioTemplate = activeTemplates?.find(template => 
                              template.title.toLowerCase().includes('nursing i/o')
                            );
                            if (ioTemplate) {
                              handleSelectTemplate(ioTemplate);
                            } else {
                              toast.info("Please create a Nursing I/O template first");
                            }
                          }}>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-lg">I/O Chart</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <p className="text-sm text-muted-foreground">Record fluid intake and output</p>
                            </CardContent>
                          </Card>

                          <Card className="cursor-pointer hover:bg-accent" onClick={() => {
                            // Find the nursing meds template
                            const medsTemplate = activeTemplates?.find(template => 
                              template.title.toLowerCase().includes('nursing meds')
                            );
                            if (medsTemplate) {
                              handleSelectTemplate(medsTemplate);
                            } else {
                              toast.info("Please create a Nursing Meds template first");
                            }
                          }}>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-lg">Medications</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <p className="text-sm text-muted-foreground">Record medications administered</p>
                            </CardContent>
                          </Card>

                          <Card className="cursor-pointer hover:bg-accent" onClick={() => {
                            // Find the nursing note template
                            const noteTemplate = activeTemplates?.find(template => 
                              template.title.toLowerCase().includes('nursing note')
                            );
                            if (noteTemplate) {
                              handleSelectTemplate(noteTemplate);
                            } else {
                              toast.info("Please create a Nursing Note template first");
                            }
                          }}>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-lg">Nurse Note</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <p className="text-sm text-muted-foreground">Record general nursing notes</p>
                            </CardContent>
                          </Card>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <TemplateSelector onSelectTemplate={handleSelectTemplate} />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h2 className="text-xl font-semibold">Create Note</h2>
                    <Button 
                      variant="outline" 
                      onClick={() => setSelectedTemplate(null)}
                    >
                      Change Template
                    </Button>
                  </div>
                  <DynamicNoteForm 
                    template={selectedTemplate} 
                    encounterId={encounterId}
                    onSuccess={handleFormSuccess}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="template" className="space-y-4">
              <TemplateBuilder onSuccess={handleTemplateCreationSuccess} />
            </TabsContent>

            <TabsContent value="form" className="space-y-4">
              {selectedTemplate && (
                <DynamicNoteForm 
                  template={selectedTemplate} 
                  encounterId={encounterId}
                  onSuccess={handleFormSuccess}
                />
              )}
            </TabsContent>

            <TabsContent value="history">
              <Card>
                <CardHeader>
                  <CardTitle>Note History</CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoadingNotes ? (
                    <p>Loading notes...</p>
                  ) : isErrorNotes ? (
                    <p className="text-red-500">Failed to load notes. Please try again later.</p>
                  ) : !existingNotes || existingNotes.length === 0 ? (
                    <p>No notes have been created for this encounter yet.</p>
                  ) : (
                    <div className="space-y-4">
                      {existingNotes.map(note => (
                        <Card key={note.id}>
                          <CardHeader>
                            <CardTitle>{note.template_title}</CardTitle>
                            <p className="text-sm text-muted-foreground">
                              Created: {new Date(note.created_at).toLocaleString()}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              By: {note.practitioner_name}
                            </p>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              {Object.entries(note.data).map(([section, data]) => (
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
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}
