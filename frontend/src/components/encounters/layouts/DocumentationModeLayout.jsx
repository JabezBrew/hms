import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js';
import Clipboard from 'lucide-react/dist/esm/icons/clipboard.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

/**
 * Documentation Mode Layout
 * Full-screen layout optimized for clinical documentation
 * Current tab-based approach for deep focus writing
 */
export function DocumentationModeLayout({ encounter, formatDate, getStatusBadge, getTypeBadge, clinicalNotes, isLoadingNotes }) {
  const getAdmissionSourceText = (source) => {
    const sources = {
      'emd': 'Emergency Department',
      'outp': 'Outpatient',
      'born': 'Born in Hospital',
      'other': 'Other'
    };
    return sources[source] || source;
  };

  const getDischargeDispositionText = (disposition) => {
    const dispositions = {
      'home': 'Home',
      'other-hcf': 'Other Healthcare Facility',
      'hosp': 'Hospitalized',
      'aadvice': 'Left Against Advice',
      'exp': 'Expired'
    };
    return dispositions[disposition] || disposition;
  };

  return (
    <div className="space-y-6">
      {/* Encounter Details Card */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="flex items-center">
                <User className="h-5 w-5 mr-2 text-primary" />
                {encounter.patient_name || 'Unknown Patient'}
              </CardTitle>
              <CardDescription>
                Encounter ID: {encounter.id}
              </CardDescription>
            </div>
            <div className="flex space-x-2">
              {getTypeBadge(encounter.encounter_type)}
              {getStatusBadge(encounter.status)}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column */}
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-1">Practitioner</h3>
                <div className="flex items-center">
                  <Stethoscope className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span>{encounter.practitioner_name || 'No practitioner assigned'}</span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">Start Time</h3>
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span>{formatDate(encounter.start_time)}</span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">End Time</h3>
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span>{encounter.end_time ? formatDate(encounter.end_time) : 'Not ended'}</span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">Location</h3>
                <div className="flex items-center">
                  <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span>{encounter.location || 'No location specified'}</span>
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-1">Service Type</h3>
                <div className="flex items-center">
                  <Activity className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span>{encounter.service_type || 'No service type specified'}</span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">Reason for Visit</h3>
                <div className="flex items-start">
                  <FileText className="h-4 w-4 mr-2 mt-0.5 text-muted-foreground" />
                  <span>{encounter.reason || 'No reason specified'}</span>
                </div>
              </div>

              {encounter.encounter_type === 'inpatient' && (
                <div>
                  <h3 className="text-sm font-medium mb-1">Admission Source</h3>
                  <div className="flex items-center">
                    <Clipboard className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span>{encounter.admission_source ? getAdmissionSourceText(encounter.admission_source) : 'Not specified'}</span>
                  </div>
                </div>
              )}

              {encounter.status === 'finished' && encounter.encounter_type === 'inpatient' && (
                <div>
                  <h3 className="text-sm font-medium mb-1">Discharge Disposition</h3>
                  <div className="flex items-center">
                    <ClipboardList className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span>{encounter.discharge_disposition ? getDischargeDispositionText(encounter.discharge_disposition) : 'Not specified'}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
        <CardFooter className="border-t pt-6">
          <div className="flex items-center text-sm text-muted-foreground">
            <CalendarClock className="h-4 w-4 mr-2" />
            <span>Created: {formatDate(encounter.created_at)}</span>
            {encounter.updated_at && encounter.updated_at !== encounter.created_at && (
              <>
                <span className="mx-2">•</span>
                <span>Last updated: {formatDate(encounter.updated_at)}</span>
              </>
            )}
          </div>
        </CardFooter>
      </Card>

      {/* Tabbed Content Area */}
      <Tabs defaultValue="timeline" className="mt-6">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="vitals">Vitals</TabsTrigger>
          <TabsTrigger value="diagnoses">Diagnoses</TabsTrigger>
          <TabsTrigger value="medications">Medications</TabsTrigger>
          <TabsTrigger value="procedures">Procedures</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Encounter Timeline</CardTitle>
              <CardDescription>History of events for this encounter</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-start">
                  <div className="mr-4 mt-1">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                  </div>
                  <div>
                    <div className="font-medium">Encounter Created</div>
                    <div className="text-sm text-muted-foreground">{formatDate(encounter.created_at)}</div>
                  </div>
                </div>
                {encounter.status === 'in-progress' && (
                  <div className="flex items-start">
                    <div className="mr-4 mt-1">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    </div>
                    <div>
                      <div className="font-medium">Encounter Started</div>
                      <div className="text-sm text-muted-foreground">{formatDate(encounter.start_time)}</div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Clinical Notes</CardTitle>
              <CardDescription>Documentation for this encounter</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingNotes ? (
                <p className="text-sm text-muted-foreground">Loading notes...</p>
              ) : clinicalNotes && clinicalNotes.length > 0 ? (
                <div className="space-y-4">
                  {clinicalNotes.map((note) => (
                    <div key={note.id} className="border-l-2 border-primary pl-4">
                      <div className="font-medium">{note.title}</div>
                      <div className="text-sm text-muted-foreground mt-1">{note.content}</div>
                      <div className="text-xs text-muted-foreground mt-2">
                        {formatDate(note.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No clinical notes available</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vitals" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Vital Signs</CardTitle>
              <CardDescription>Patient vitals recorded during this encounter</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">No vitals recorded yet</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="diagnoses" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Diagnoses</CardTitle>
              <CardDescription>Diagnoses for this encounter</CardDescription>
            </CardHeader>
            <CardContent>
              {encounter.diagnosis ? (
                <p className="text-sm">{encounter.diagnosis}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No diagnoses recorded</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="medications" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Medications</CardTitle>
              <CardDescription>Medications prescribed during this encounter</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">No medications prescribed yet</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="procedures" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Procedures</CardTitle>
              <CardDescription>Procedures performed during this encounter</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">No procedures recorded yet</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
