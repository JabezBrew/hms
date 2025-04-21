import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { apiClient } from '@/lib/api';
import { format, addHours, isAfter, isBefore, parseISO } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Clock, CheckCircle, XCircle, AlertTriangle, Search } from 'lucide-react';

export function MedicationAdministration({ patient }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [medications, setMedications] = useState([]);
  const [administrationHistory, setAdministrationHistory] = useState([]);
  const [selectedMedication, setSelectedMedication] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({
    dose_given: '',
    notes: '',
    status: 'administered'
  });

  // Fetch medications and administration history
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // In a real application, this would fetch from an API endpoint
        // For demo purposes, we'll generate some sample data
        const sampleMedications = generateSampleMedications(patient.id);
        const sampleHistory = generateSampleAdministrationHistory(sampleMedications);
        
        setMedications(sampleMedications);
        setAdministrationHistory(sampleHistory);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching medication data:', err);
        setError('Failed to load medication data. Please try again.');
        setLoading(false);
      }
    };

    fetchData();
  }, [patient.id]);

  // Generate sample medications for demo purposes
  const generateSampleMedications = (patientId) => {
    const now = new Date();
    const medications = [
      {
        id: `med-${patientId}-1`,
        name: 'Paracetamol',
        dose: '1000mg',
        route: 'Oral',
        frequency: 'Every 6 hours',
        start_date: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
        end_date: addDays(now, 3).toISOString(), // 3 days from now
        status: 'active',
        instructions: 'Take with food',
        next_due: addHours(now, 2).toISOString(), // 2 hours from now
        prescriber: 'Dr. Smith'
      },
      {
        id: `med-${patientId}-2`,
        name: 'Amoxicillin',
        dose: '500mg',
        route: 'Oral',
        frequency: 'Every 8 hours',
        start_date: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
        end_date: addDays(now, 7).toISOString(), // 7 days from now
        status: 'active',
        instructions: 'Take with water',
        next_due: addHours(now, -1).toISOString(), // 1 hour ago (overdue)
        prescriber: 'Dr. Johnson'
      },
      {
        id: `med-${patientId}-3`,
        name: 'Ibuprofen',
        dose: '400mg',
        route: 'Oral',
        frequency: 'Every 8 hours as needed',
        start_date: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
        end_date: addDays(now, 5).toISOString(), // 5 days from now
        status: 'active',
        instructions: 'Take with food for pain',
        next_due: addHours(now, 4).toISOString(), // 4 hours from now
        prescriber: 'Dr. Smith'
      },
      {
        id: `med-${patientId}-4`,
        name: 'Morphine',
        dose: '5mg',
        route: 'IV',
        frequency: 'Every 4 hours as needed',
        start_date: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
        end_date: addDays(now, 2).toISOString(), // 2 days from now
        status: 'active',
        instructions: 'For severe pain only',
        next_due: addHours(now, 1).toISOString(), // 1 hour from now
        prescriber: 'Dr. Williams'
      },
      {
        id: `med-${patientId}-5`,
        name: 'Ondansetron',
        dose: '4mg',
        route: 'Oral',
        frequency: 'Every 8 hours as needed',
        start_date: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
        end_date: addDays(now, 5).toISOString(), // 5 days from now
        status: 'active',
        instructions: 'For nausea',
        next_due: addHours(now, 3).toISOString(), // 3 hours from now
        prescriber: 'Dr. Johnson'
      }
    ];
    
    return medications;
  };

  // Helper function to add days to a date
  const addDays = (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  // Generate sample administration history for demo purposes
  const generateSampleAdministrationHistory = (medications) => {
    const now = new Date();
    const history = [];
    
    medications.forEach(medication => {
      // Generate 3 past administrations for each medication
      for (let i = 0; i < 3; i++) {
        const timestamp = new Date(now.getTime() - (i + 1) * 8 * 60 * 60 * 1000); // 8, 16, 24 hours ago
        
        history.push({
          id: `adm-${medication.id}-${i}`,
          medication_id: medication.id,
          medication_name: medication.name,
          scheduled_time: new Date(timestamp.getTime() - 30 * 60 * 1000).toISOString(), // 30 minutes before administration
          administration_time: timestamp.toISOString(),
          dose_given: medication.dose,
          route: medication.route,
          administered_by: 'Nurse Johnson',
          status: Math.random() > 0.2 ? 'administered' : 'missed', // 80% administered, 20% missed
          notes: Math.random() > 0.7 ? 'Patient reported pain relief' : ''
        });
      }
    });
    
    return history.sort((a, b) => new Date(b.administration_time) - new Date(a.administration_time));
  };

  // Filter medications based on search term
  const filteredMedications = medications.filter(medication => 
    medication.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    medication.prescriber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Handle medication selection
  const handleMedicationSelect = (medication) => {
    setSelectedMedication(medication);
    setFormData({
      dose_given: medication.dose,
      notes: '',
      status: 'administered'
    });
  };

  // Handle input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle select changes
  const handleSelectChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      // In a real application, this would send data to an API endpoint
      // For demo purposes, we'll just add it to the local state
      const newAdministration = {
        id: `adm-${selectedMedication.id}-${Date.now()}`,
        medication_id: selectedMedication.id,
        medication_name: selectedMedication.name,
        scheduled_time: selectedMedication.next_due,
        administration_time: new Date().toISOString(),
        dose_given: formData.dose_given,
        route: selectedMedication.route,
        administered_by: 'Current Nurse',
        status: formData.status,
        notes: formData.notes
      };
      
      setAdministrationHistory([newAdministration, ...administrationHistory]);
      
      // Update next due time for the medication
      const updatedMedications = medications.map(med => {
        if (med.id === selectedMedication.id) {
          // Calculate next due time based on frequency
          let hoursToAdd = 6; // default
          if (med.frequency.includes('6 hours')) hoursToAdd = 6;
          if (med.frequency.includes('8 hours')) hoursToAdd = 8;
          if (med.frequency.includes('4 hours')) hoursToAdd = 4;
          
          return {
            ...med,
            next_due: addHours(new Date(), hoursToAdd).toISOString()
          };
        }
        return med;
      });
      
      setMedications(updatedMedications);
      setSelectedMedication(null);
      
      // Show success message (in a real app, we'd use a toast notification)
      alert('Medication administered successfully');
    } catch (err) {
      console.error('Error administering medication:', err);
      setError('Failed to record medication administration. Please try again.');
    }
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    return format(new Date(timestamp), 'MMM d, yyyy h:mm a');
  };

  // Check if a medication is overdue
  const isOverdue = (nextDue) => {
    return isBefore(new Date(nextDue), new Date());
  };

  // Check if a medication is due soon (within the next hour)
  const isDueSoon = (nextDue) => {
    const dueTime = new Date(nextDue);
    const oneHourFromNow = addHours(new Date(), 1);
    return isAfter(dueTime, new Date()) && isBefore(dueTime, oneHourFromNow);
  };

  // Get status badge for a medication
  const getMedicationStatusBadge = (medication) => {
    if (isOverdue(medication.next_due)) {
      return <Badge variant="destructive">Overdue</Badge>;
    }
    if (isDueSoon(medication.next_due)) {
      return <Badge variant="warning">Due Soon</Badge>;
    }
    return <Badge variant="outline">Scheduled</Badge>;
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
      {selectedMedication ? (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle>Administer {selectedMedication.name}</CardTitle>
                <CardDescription>
                  {selectedMedication.dose} - {selectedMedication.route} - {selectedMedication.frequency}
                </CardDescription>
              </div>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setSelectedMedication(null)}
              >
                Back to Medications
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dose_given">Dose Given</Label>
                  <Input
                    id="dose_given"
                    name="dose_given"
                    value={formData.dose_given}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="status">Administration Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => handleSelectChange('status', value)}
                  >
                    <SelectTrigger id="status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="administered">Administered</SelectItem>
                      <SelectItem value="missed">Missed</SelectItem>
                      <SelectItem value="refused">Patient Refused</SelectItem>
                      <SelectItem value="held">Held</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  name="notes"
                  placeholder="Any additional observations"
                  value={formData.notes}
                  onChange={handleInputChange}
                />
              </div>
              
              <div className="pt-4">
                <Button type="submit" className="w-full">Record Administration</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search medications..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <Tabs defaultValue="due">
            <TabsList>
              <TabsTrigger value="due">Due Medications</TabsTrigger>
              <TabsTrigger value="all">All Medications</TabsTrigger>
              <TabsTrigger value="history">Administration History</TabsTrigger>
            </TabsList>
            
            <TabsContent value="due" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Medications Due</CardTitle>
                  <CardDescription>
                    Medications that are due or overdue for administration
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-4">
                      {filteredMedications
                        .filter(med => isOverdue(med.next_due) || isDueSoon(med.next_due))
                        .map(medication => (
                          <div
                            key={medication.id}
                            className={`p-4 border rounded-md cursor-pointer hover:bg-muted transition-colors ${
                              isOverdue(medication.next_due) ? 'border-red-300 bg-red-50' : 
                              isDueSoon(medication.next_due) ? 'border-yellow-300 bg-yellow-50' : ''
                            }`}
                            onClick={() => handleMedicationSelect(medication)}
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <h3 className="font-medium">{medication.name} - {medication.dose}</h3>
                                <p className="text-sm text-muted-foreground">
                                  {medication.route} - {medication.frequency}
                                </p>
                              </div>
                              <div className="flex flex-col items-end">
                                {getMedicationStatusBadge(medication)}
                                <div className="flex items-center text-sm text-muted-foreground mt-1">
                                  <Clock className="h-3 w-3 mr-1" />
                                  {formatTimestamp(medication.next_due)}
                                </div>
                              </div>
                            </div>
                            
                            <div className="mt-2 text-sm">
                              <p className="text-muted-foreground">{medication.instructions}</p>
                              <p className="mt-1">Prescribed by: {medication.prescriber}</p>
                            </div>
                            
                            <div className="mt-2">
                              <Button 
                                size="sm" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMedicationSelect(medication);
                                }}
                              >
                                Administer
                              </Button>
                            </div>
                          </div>
                        ))}
                        
                      {filteredMedications.filter(med => isOverdue(med.next_due) || isDueSoon(med.next_due)).length === 0 && (
                        <div className="text-center p-4">
                          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-2" />
                          <p className="text-lg font-medium">No medications due</p>
                          <p className="text-muted-foreground">
                            There are no medications due for administration at this time.
                          </p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="all" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>All Medications</CardTitle>
                  <CardDescription>
                    All active medications for {patient.user.full_name}
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
                          <TableHead>Next Due</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredMedications.map(medication => (
                          <TableRow key={medication.id}>
                            <TableCell className="font-medium">{medication.name}</TableCell>
                            <TableCell>{medication.dose}</TableCell>
                            <TableCell>{medication.route}</TableCell>
                            <TableCell>{medication.frequency}</TableCell>
                            <TableCell>{formatTimestamp(medication.next_due)}</TableCell>
                            <TableCell>{getMedicationStatusBadge(medication)}</TableCell>
                            <TableCell>
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleMedicationSelect(medication)}
                              >
                                Administer
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="history" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Administration History</CardTitle>
                  <CardDescription>
                    Recent medication administrations for {patient.user.full_name}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Medication</TableHead>
                          <TableHead>Dose</TableHead>
                          <TableHead>Route</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Administered By</TableHead>
                          <TableHead>Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {administrationHistory.map(record => (
                          <TableRow key={record.id}>
                            <TableCell>{formatTimestamp(record.administration_time)}</TableCell>
                            <TableCell className="font-medium">{record.medication_name}</TableCell>
                            <TableCell>{record.dose_given}</TableCell>
                            <TableCell>{record.route}</TableCell>
                            <TableCell>
                              {record.status === 'administered' ? (
                                <Badge variant="success">Administered</Badge>
                              ) : record.status === 'missed' ? (
                                <Badge variant="destructive">Missed</Badge>
                              ) : record.status === 'refused' ? (
                                <Badge variant="warning">Refused</Badge>
                              ) : (
                                <Badge variant="outline">Held</Badge>
                              )}
                            </TableCell>
                            <TableCell>{record.administered_by}</TableCell>
                            <TableCell>{record.notes}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}