import Activity from 'lucide-react/dist/esm/icons/activity.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import format from 'date-fns/format';

export function WardRoundTools({ patient }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [vitalSigns, setVitalSigns] = useState([]);
  const [notes, setNotes] = useState([]);
  const [medications, setMedications] = useState([]);
  const [labResults, setLabResults] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [newNote, setNewNote] = useState('');

  // Fetch patient data
  useEffect(() => {
    const fetchPatientData = async () => {
      try {
        setLoading(true);
        // In a real application, this would fetch from API endpoints
        // For demo purposes, we'll generate some sample data
        
        // Generate sample vital signs
        const sampleVitalSigns = generateSampleVitalSigns(patient.id);
        setVitalSigns(sampleVitalSigns);
        
        // Generate sample notes
        const sampleNotes = generateSampleNotes(patient.id);
        setNotes(sampleNotes);
        
        // Generate sample medications
        const sampleMedications = generateSampleMedications(patient.id);
        setMedications(sampleMedications);
        
        // Generate sample lab results
        const sampleLabResults = generateSampleLabResults(patient.id);
        setLabResults(sampleLabResults);
        
        // Generate sample tasks
        const sampleTasks = generateSampleTasks(patient.id);
        setTasks(sampleTasks);
        
        setLoading(false);
      } catch (err) {
        console.error('Error fetching patient data:', err);
        setError('Failed to load patient data. Please try again.');
        setLoading(false);
      }
    };

    fetchPatientData();
  }, [patient.id]);

  // Generate sample vital signs data for demo purposes
  const generateSampleVitalSigns = (patientId) => {
    const now = new Date();
    const data = [];
    
    // Generate data points for the last 24 hours (every 4 hours)
    for (let i = 0; i < 6; i++) {
      const timestamp = new Date(now);
      timestamp.setHours(now.getHours() - (i * 4));
      
      data.push({
        id: `vs-${patientId}-${i}`,
        timestamp: timestamp.toISOString(),
        temperature: (Math.random() * (37.8 - 36.5) + 36.5).toFixed(1),
        heart_rate: Math.floor(Math.random() * (100 - 60) + 60),
        respiratory_rate: Math.floor(Math.random() * (20 - 12) + 12),
        blood_pressure_systolic: Math.floor(Math.random() * (140 - 110) + 110),
        blood_pressure_diastolic: Math.floor(Math.random() * (90 - 70) + 70),
        oxygen_saturation: Math.floor(Math.random() * (100 - 94) + 94),
        pain_level: Math.floor(Math.random() * 6),
        recorded_by: 'Nurse Johnson'
      });
    }
    
    return data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  };

  // Generate sample notes for demo purposes
  const generateSampleNotes = (patientId) => {
    const now = new Date();
    const notes = [
      {
        id: `note-${patientId}-1`,
        timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        content: "Patient reports feeling better today. Pain has decreased from 7/10 to 3/10. Continuing current pain management plan.",
        author: "Dr. Smith",
        type: "Progress Note"
      },
      {
        id: `note-${patientId}-2`,
        timestamp: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString(), // 8 hours ago
        content: "Reviewed lab results. WBC count trending down. Continue current antibiotic regimen.",
        author: "Dr. Johnson",
        type: "Lab Review"
      },
      {
        id: `note-${patientId}-3`,
        timestamp: new Date(now.getTime() - 16 * 60 * 60 * 1000).toISOString(), // 16 hours ago
        content: "Patient complaining of nausea after morning medication. Administered ondansetron 4mg IV with good effect.",
        author: "Nurse Williams",
        type: "Nursing Note"
      }
    ];
    
    return notes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  };

  // Generate sample medications for demo purposes
  const generateSampleMedications = (patientId) => {
    const now = new Date();
    const medications = [
      {
        id: `med-${patientId}-1`,
        name: "Ceftriaxone",
        dose: "1g",
        route: "IV",
        frequency: "Every 12 hours",
        start_date: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
        end_date: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString(), // 6 days from now
        status: "active",
        prescriber: "Dr. Smith"
      },
      {
        id: `med-${patientId}-2`,
        name: "Acetaminophen",
        dose: "1000mg",
        route: "Oral",
        frequency: "Every 6 hours as needed",
        start_date: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
        end_date: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString(), // 6 days from now
        status: "active",
        prescriber: "Dr. Smith"
      }
    ];
    
    return medications;
  };

  // Generate sample lab results for demo purposes
  const generateSampleLabResults = (patientId) => {
    const now = new Date();
    const results = [
      {
        id: `lab-${patientId}-1`,
        test_name: "Complete Blood Count",
        timestamp: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
        status: "completed",
        results: [
          { name: "WBC", value: "12.3", unit: "10^3/µL", reference: "4.5-11.0", abnormal: true },
          { name: "RBC", value: "4.8", unit: "10^6/µL", reference: "4.5-5.9", abnormal: false },
          { name: "Hemoglobin", value: "14.2", unit: "g/dL", reference: "13.5-17.5", abnormal: false }
        ]
      },
      {
        id: `lab-${patientId}-2`,
        test_name: "Basic Metabolic Panel",
        timestamp: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
        status: "completed",
        results: [
          { name: "Sodium", value: "138", unit: "mmol/L", reference: "135-145", abnormal: false },
          { name: "Potassium", value: "3.9", unit: "mmol/L", reference: "3.5-5.0", abnormal: false },
          { name: "Glucose", value: "110", unit: "mg/dL", reference: "70-99", abnormal: true }
        ]
      }
    ];
    
    return results;
  };

  // Generate sample tasks for demo purposes
  const generateSampleTasks = (patientId) => {
    const now = new Date();
    const tasks = [
      {
        id: `task-${patientId}-1`,
        description: "Follow up on blood culture results",
        created_at: new Date(now.getTime() - 20 * 60 * 60 * 1000).toISOString(), // 20 hours ago
        due_date: new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(), // 4 hours from now
        assigned_to: "Dr. Smith",
        assigned_by: "Dr. Smith",
        status: "pending",
        priority: "high"
      },
      {
        id: `task-${patientId}-2`,
        description: "Consult pulmonology for respiratory assessment",
        created_at: new Date(now.getTime() - 22 * 60 * 60 * 1000).toISOString(), // 22 hours ago
        due_date: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
        assigned_to: "Dr. Johnson",
        assigned_by: "Dr. Smith",
        status: "pending",
        priority: "medium"
      }
    ];
    
    return tasks;
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    return format(new Date(timestamp), 'MMM d, yyyy h:mm a');
  };

  // Handle new note submission
  const handleNoteSubmit = (e) => {
    e.preventDefault();
    
    if (!newNote.trim()) {
      alert('Please enter a note');
      return;
    }
    
    const note = {
      id: `note-${patient.id}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      content: newNote,
      author: "Current Doctor",
      type: "Progress Note"
    };
    
    setNotes([note, ...notes]);
    setNewNote('');
  };

  // Get priority badge
  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'high':
        return <Badge variant="destructive">High</Badge>;
      case 'medium':
        return <Badge variant="warning">Medium</Badge>;
      case 'low':
        return <Badge variant="outline">Low</Badge>;
      default:
        return <Badge variant="outline">{priority}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-red-500">Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{error}</p>
          <Button 
            variant="outline" 
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">
            <FileText className="size-4 mr-2" />
            Summary
          </TabsTrigger>
          <TabsTrigger value="vitals">
            <Activity className="size-4 mr-2" />
            Vitals
          </TabsTrigger>
          <TabsTrigger value="notes">
            <FileText className="size-4 mr-2" />
            Notes
          </TabsTrigger>
          <TabsTrigger value="medications">
            <Pill className="size-4 mr-2" />
            Medications
          </TabsTrigger>
          <TabsTrigger value="labs">
            <FlaskConical className="size-4 mr-2" />
            Labs
          </TabsTrigger>
          <TabsTrigger value="tasks">
            <CheckCircle2 className="size-4 mr-2" />
            Tasks
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="summary" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Patient Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Patient Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-sm text-muted-foreground">Age</p>
                      <p>{patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Gender</p>
                      <p>{patient.gender || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Admission Date</p>
                      <p>{format(new Date(patient.admission.admission_date), 'MMM d, yyyy')}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Admission Type</p>
                      <p className="capitalize">{patient.admission.admission_type.replace('_', ' ')}</p>
                    </div>
                  </div>
                  
                  <div className="pt-2">
                    <p className="text-sm text-muted-foreground">Admission Notes</p>
                    <p className="text-sm">{patient.admission.admission_notes || 'No admission notes available.'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Latest Vitals */}
            <Card>
              <CardHeader>
                <CardTitle>Latest Vitals</CardTitle>
                <CardDescription>
                  {vitalSigns.length > 0 ? formatTimestamp(vitalSigns[0].timestamp) : 'No data'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {vitalSigns.length > 0 ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Temperature</p>
                      <p className="text-lg font-medium">{vitalSigns[0].temperature} °C</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Heart Rate</p>
                      <p className="text-lg font-medium">{vitalSigns[0].heart_rate} bpm</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Blood Pressure</p>
                      <p className="text-lg font-medium">{vitalSigns[0].blood_pressure_systolic}/{vitalSigns[0].blood_pressure_diastolic} mmHg</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Oxygen Saturation</p>
                      <p className="text-lg font-medium">{vitalSigns[0].oxygen_saturation}%</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No vital signs recorded</p>
                )}
              </CardContent>
            </Card>
            
            {/* Latest Note */}
            <Card>
              <CardHeader>
                <CardTitle>Latest Note</CardTitle>
                <CardDescription>
                  {notes.length > 0 ? `${notes[0].type} - ${formatTimestamp(notes[0].timestamp)}` : 'No notes'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {notes.length > 0 ? (
                  <div>
                    <p className="text-sm">{notes[0].content}</p>
                    <p className="text-sm text-muted-foreground mt-2">By: {notes[0].author}</p>
                  </div>
                ) : (
                  <p className="text-muted-foreground">No notes available</p>
                )}
              </CardContent>
            </Card>
            
            {/* Pending Tasks */}
            <Card>
              <CardHeader>
                <CardTitle>Pending Tasks</CardTitle>
                <CardDescription>
                  {tasks.filter(task => task.status === 'pending').length} tasks pending
                </CardDescription>
              </CardHeader>
              <CardContent>
                {tasks.filter(task => task.status === 'pending').length > 0 ? (
                  <div className="space-y-2">
                    {tasks
                      .filter(task => task.status === 'pending')
                      .slice(0, 3)
                      .map(task => (
                        <div key={task.id} className="flex justify-between items-start border-b pb-2">
                          <div>
                            <p className="text-sm">{task.description}</p>
                            <p className="text-xs text-muted-foreground">Due: {format(new Date(task.due_date), 'MMM d, h:mm a')}</p>
                          </div>
                          <div className="flex items-center">
                            {getPriorityBadge(task.priority)}
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No pending tasks</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="notes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Clinical Notes</CardTitle>
              <CardDescription>
                Add and view clinical notes for {patient.user.full_name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Add new note */}
                <form onSubmit={handleNoteSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="newNote">Add Note</Label>
                    <Textarea
                      id="newNote"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Enter clinical note..."
                      rows={4}
                      required
                    />
                  </div>
                  <Button type="submit">Add Note</Button>
                </form>
                
                {/* Notes list */}
                <div className="pt-4">
                  <h3 className="text-lg font-medium mb-2">Previous Notes</h3>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-4">
                      {notes.map(note => (
                        <div key={note.id} className="border rounded-md p-4">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <Badge variant="outline">{note.type}</Badge>
                              <span className="text-sm text-muted-foreground ml-2">
                                {formatTimestamp(note.timestamp)}
                              </span>
                            </div>
                            <span className="text-sm font-medium">{note.author}</span>
                          </div>
                          <p className="text-sm">{note.content}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="medications" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Medications</CardTitle>
              <CardDescription>
                Current medications for {patient.user.full_name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Medication</TableHead>
                      <TableHead>Dose</TableHead>
                      <TableHead>Route</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead>Prescriber</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {medications.map(med => (
                      <TableRow key={med.id}>
                        <TableCell className="font-medium">{med.name}</TableCell>
                        <TableCell>{med.dose}</TableCell>
                        <TableCell>{med.route}</TableCell>
                        <TableCell>{med.frequency}</TableCell>
                        <TableCell>{formatTimestamp(med.start_date)}</TableCell>
                        <TableCell>{formatTimestamp(med.end_date)}</TableCell>
                        <TableCell>{med.prescriber}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="labs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Laboratory Results</CardTitle>
              <CardDescription>
                Lab results for {patient.user.full_name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {labResults.map(lab => (
                  <div key={lab.id} className="border rounded-md p-4">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-medium">{lab.test_name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {formatTimestamp(lab.timestamp)}
                        </p>
                      </div>
                      <Badge 
                        variant={lab.status === 'completed' ? 'success' : 'outline'}
                      >
                        {lab.status}
                      </Badge>
                    </div>
                    
                    {lab.results.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Test</TableHead>
                            <TableHead>Result</TableHead>
                            <TableHead>Units</TableHead>
                            <TableHead>Reference Range</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {lab.results.map((result, index) => (
                            <TableRow key={index}>
                              <TableCell>{result.name}</TableCell>
                              <TableCell className={result.abnormal ? 'text-red-600 font-medium' : ''}>
                                {result.value}
                              </TableCell>
                              <TableCell>{result.unit}</TableCell>
                              <TableCell>{result.reference}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-muted-foreground">Results pending</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
