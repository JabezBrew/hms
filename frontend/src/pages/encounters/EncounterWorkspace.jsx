import { useParams } from 'react-router-dom';
import { useEncounter } from '@/hooks/useEncounterQueries';
import { usePatient } from '@/hooks/usePatientQueries';
import { SmartNoteEditor } from '@/components/encounter/SmartNoteEditor';
import { ReviewOfSystems } from '@/components/encounter/ReviewOfSystems';
import { SentenceBuilder } from '@/components/ordering/SentenceBuilder';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';

const EncounterWorkspace = () => {
    const { id } = useParams();
    const { data: encounter, isLoading: loadingEncounter } = useEncounter(id);
    // Fetch patient using encounter's patient_id if available
    const { data: patient, isLoading: loadingPatient } = usePatient(encounter?.patient_id);

    if (loadingEncounter) return <div className="p-6"><Skeleton className="h-12 w-full mb-4" /><Skeleton className="h-96 w-full" /></div>;

    return (
        <div className="h-screen flex flex-col bg-background overflow-hidden">
            {/* Sticky Header */}
            <PatientHeader patient={patient} onAction={() => { }} />

            {/* Split Workspace */}
            <div className="flex-1 overflow-hidden">
                <ResizablePanelGroup direction="horizontal">

                    {/* Left Panel: Reference (Chart) */}
                    <ResizablePanel defaultSize={40} minSize={30}>
                        <ScrollArea className="h-full">
                            <div className="p-4 space-y-6">
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-sm font-medium uppercase text-muted-foreground">Snapshot</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div>
                                            <h4 className="font-semibold text-sm mb-1">Active Problems</h4>
                                            <ul className="text-sm text-muted-foreground list-disc pl-4">
                                                <li>Hypertension</li>
                                                <li>Type 2 Diabetes</li>
                                            </ul>
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-sm mb-1">Current Meds</h4>
                                            <ul className="text-sm text-muted-foreground list-disc pl-4">
                                                <li>Lisinopril 10mg</li>
                                                <li>Metformin 500mg</li>
                                            </ul>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-sm font-medium uppercase text-muted-foreground">Last Visit</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-muted-foreground">
                                            Oct 15, 2023 - Cardiology Consult
                                            <br />
                                            "Patient stable. Continue current management."
                                        </p>
                                    </CardContent>
                                </Card>
                            </div>
                        </ScrollArea>
                    </ResizablePanel>

                    <ResizableHandle withHandle />

                    {/* Right Panel: Documentation */}
                    <ResizablePanel defaultSize={60}>
                        <div className="h-full flex flex-col bg-muted/10">
                            <Tabs defaultValue="note" className="flex-1 flex flex-col">
                                <div className="px-4 pt-2 border-b bg-background">
                                    <TabsList>
                                        <TabsTrigger value="note">Clinical Note</TabsTrigger>
                                        <TabsTrigger value="ros">Review of Systems</TabsTrigger>
                                        <TabsTrigger value="orders">Orders & Plan</TabsTrigger>
                                    </TabsList>
                                </div>

                                <div className="flex-1 overflow-hidden p-4">
                                    <TabsContent value="note" className="h-full mt-0">
                                        <SmartNoteEditor />
                                    </TabsContent>

                                    <TabsContent value="ros" className="h-full mt-0 overflow-auto">
                                        <Card>
                                            <CardContent className="pt-6">
                                                <ReviewOfSystems />
                                            </CardContent>
                                        </Card>
                                    </TabsContent>

                                    <TabsContent value="orders" className="h-full mt-0 overflow-auto">
                                        <div className="p-4">
                                            <SentenceBuilder />
                                        </div>
                                    </TabsContent>
                                </div>
                            </Tabs>
                        </div>
                    </ResizablePanel>

                </ResizablePanelGroup>
            </div>
        </div>
    );
};

export default EncounterWorkspace;
