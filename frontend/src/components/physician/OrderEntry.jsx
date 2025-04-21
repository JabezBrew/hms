import { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Pill, FlaskConical, ImageIcon, Calendar } from 'lucide-react';
import { format } from 'date-fns';

export function OrderEntry({ patient }) {
  const [activeTab, setActiveTab] = useState('medications');
  const [medicationOrders, setMedicationOrders] = useState([]);
  const [labOrders, setLabOrders] = useState([]);
  const [imagingOrders, setImagingOrders] = useState([]);
  
  // Medication order form state
  const [medicationForm, setMedicationForm] = useState({
    medication: '',
    dose: '',
    route: '',
    frequency: '',
    duration: '',
    instructions: '',
    urgent: false
  });
  
  // Lab order form state
  const [labForm, setLabForm] = useState({
    test: '',
    specimen: '',
    instructions: '',
    urgent: false
  });
  
  // Imaging order form state
  const [imagingForm, setImagingForm] = useState({
    study: '',
    bodyPart: '',
    instructions: '',
    contrast: false,
    urgent: false
  });

  // Common medications for quick selection
  const commonMedications = [
    { name: 'Acetaminophen', dose: '500mg', route: 'Oral', frequency: 'Every 6 hours as needed' },
    { name: 'Ibuprofen', dose: '400mg', route: 'Oral', frequency: 'Every 8 hours as needed' },
    { name: 'Amoxicillin', dose: '500mg', route: 'Oral', frequency: 'Every 8 hours' },
    { name: 'Loratadine', dose: '10mg', route: 'Oral', frequency: 'Once daily' },
    { name: 'Omeprazole', dose: '20mg', route: 'Oral', frequency: 'Once daily' }
  ];
  
  // Common lab tests for quick selection
  const commonLabTests = [
    { name: 'Complete Blood Count (CBC)', specimen: 'Blood' },
    { name: 'Basic Metabolic Panel (BMP)', specimen: 'Blood' },
    { name: 'Comprehensive Metabolic Panel (CMP)', specimen: 'Blood' },
    { name: 'Urinalysis', specimen: 'Urine' },
    { name: 'Blood Culture', specimen: 'Blood' }
  ];
  
  // Common imaging studies for quick selection
  const commonImagingStudies = [
    { name: 'Chest X-ray', bodyPart: 'Chest' },
    { name: 'CT Scan', bodyPart: 'Head' },
    { name: 'MRI', bodyPart: 'Brain' },
    { name: 'Ultrasound', bodyPart: 'Abdomen' },
    { name: 'X-ray', bodyPart: 'Extremity' }
  ];

  // Handle medication form input changes
  const handleMedicationFormChange = (field, value) => {
    setMedicationForm(prev => ({ ...prev, [field]: value }));
  };
  
  // Handle lab form input changes
  const handleLabFormChange = (field, value) => {
    setLabForm(prev => ({ ...prev, [field]: value }));
  };
  
  // Handle imaging form input changes
  const handleImagingFormChange = (field, value) => {
    setImagingForm(prev => ({ ...prev, [field]: value }));
  };

  // Handle quick selection of common medication
  const handleQuickMedication = (medication) => {
    setMedicationForm({
      ...medicationForm,
      medication: medication.name,
      dose: medication.dose,
      route: medication.route,
      frequency: medication.frequency
    });
  };
  
  // Handle quick selection of common lab test
  const handleQuickLabTest = (test) => {
    setLabForm({
      ...labForm,
      test: test.name,
      specimen: test.specimen
    });
  };
  
  // Handle quick selection of common imaging study
  const handleQuickImagingStudy = (study) => {
    setImagingForm({
      ...imagingForm,
      study: study.name,
      bodyPart: study.bodyPart
    });
  };

  // Submit medication order
  const handleMedicationOrderSubmit = (e) => {
    e.preventDefault();
    
    // Validate form
    if (!medicationForm.medication || !medicationForm.dose || !medicationForm.route || !medicationForm.frequency) {
      alert('Please fill in all required fields');
      return;
    }
    
    // Create new order
    const newOrder = {
      id: `med-order-${Date.now()}`,
      type: 'medication',
      patient: patient.id,
      medication: medicationForm.medication,
      dose: medicationForm.dose,
      route: medicationForm.route,
      frequency: medicationForm.frequency,
      duration: medicationForm.duration,
      instructions: medicationForm.instructions,
      urgent: medicationForm.urgent,
      status: 'pending',
      ordered_by: 'Current Doctor',
      ordered_at: new Date().toISOString()
    };
    
    // Add to orders list
    setMedicationOrders([newOrder, ...medicationOrders]);
    
    // Reset form
    setMedicationForm({
      medication: '',
      dose: '',
      route: '',
      frequency: '',
      duration: '',
      instructions: '',
      urgent: false
    });
    
    // Show success message
    alert('Medication order submitted successfully');
  };
  
  // Submit lab order
  const handleLabOrderSubmit = (e) => {
    e.preventDefault();
    
    // Validate form
    if (!labForm.test || !labForm.specimen) {
      alert('Please fill in all required fields');
      return;
    }
    
    // Create new order
    const newOrder = {
      id: `lab-order-${Date.now()}`,
      type: 'lab',
      patient: patient.id,
      test: labForm.test,
      specimen: labForm.specimen,
      instructions: labForm.instructions,
      urgent: labForm.urgent,
      status: 'pending',
      ordered_by: 'Current Doctor',
      ordered_at: new Date().toISOString()
    };
    
    // Add to orders list
    setLabOrders([newOrder, ...labOrders]);
    
    // Reset form
    setLabForm({
      test: '',
      specimen: '',
      instructions: '',
      urgent: false
    });
    
    // Show success message
    alert('Lab order submitted successfully');
  };
  
  // Submit imaging order
  const handleImagingOrderSubmit = (e) => {
    e.preventDefault();
    
    // Validate form
    if (!imagingForm.study || !imagingForm.bodyPart) {
      alert('Please fill in all required fields');
      return;
    }
    
    // Create new order
    const newOrder = {
      id: `imaging-order-${Date.now()}`,
      type: 'imaging',
      patient: patient.id,
      study: imagingForm.study,
      bodyPart: imagingForm.bodyPart,
      instructions: imagingForm.instructions,
      contrast: imagingForm.contrast,
      urgent: imagingForm.urgent,
      status: 'pending',
      ordered_by: 'Current Doctor',
      ordered_at: new Date().toISOString()
    };
    
    // Add to orders list
    setImagingOrders([newOrder, ...imagingOrders]);
    
    // Reset form
    setImagingForm({
      study: '',
      bodyPart: '',
      instructions: '',
      contrast: false,
      urgent: false
    });
    
    // Show success message
    alert('Imaging order submitted successfully');
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    return format(new Date(timestamp), 'MMM d, yyyy h:mm a');
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="medications">
            <Pill className="h-4 w-4 mr-2" />
            Medications
          </TabsTrigger>
          <TabsTrigger value="labs">
            <FlaskConical className="h-4 w-4 mr-2" />
            Lab Tests
          </TabsTrigger>
          <TabsTrigger value="imaging">
            <ImageIcon className="h-4 w-4 mr-2" />
            Imaging
          </TabsTrigger>
        </TabsList>
        
        {/* Medications Tab */}
        <TabsContent value="medications" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Order Form */}
            <Card>
              <CardHeader>
                <CardTitle>Order Medication</CardTitle>
                <CardDescription>
                  Create a new medication order for {patient.user.full_name}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleMedicationOrderSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="medication">Medication</Label>
                    <Input
                      id="medication"
                      value={medicationForm.medication}
                      onChange={(e) => handleMedicationFormChange('medication', e.target.value)}
                      placeholder="Enter medication name"
                      required
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="dose">Dose</Label>
                      <Input
                        id="dose"
                        value={medicationForm.dose}
                        onChange={(e) => handleMedicationFormChange('dose', e.target.value)}
                        placeholder="e.g., 500mg"
                        required
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="route">Route</Label>
                      <Select
                        value={medicationForm.route}
                        onValueChange={(value) => handleMedicationFormChange('route', value)}
                      >
                        <SelectTrigger id="route">
                          <SelectValue placeholder="Select route" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Oral">Oral</SelectItem>
                          <SelectItem value="IV">IV</SelectItem>
                          <SelectItem value="IM">IM</SelectItem>
                          <SelectItem value="SC">Subcutaneous</SelectItem>
                          <SelectItem value="Topical">Topical</SelectItem>
                          <SelectItem value="Inhalation">Inhalation</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="frequency">Frequency</Label>
                      <Select
                        value={medicationForm.frequency}
                        onValueChange={(value) => handleMedicationFormChange('frequency', value)}
                      >
                        <SelectTrigger id="frequency">
                          <SelectValue placeholder="Select frequency" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Once daily">Once daily</SelectItem>
                          <SelectItem value="Twice daily">Twice daily</SelectItem>
                          <SelectItem value="Three times daily">Three times daily</SelectItem>
                          <SelectItem value="Four times daily">Four times daily</SelectItem>
                          <SelectItem value="Every 6 hours">Every 6 hours</SelectItem>
                          <SelectItem value="Every 8 hours">Every 8 hours</SelectItem>
                          <SelectItem value="Every 12 hours">Every 12 hours</SelectItem>
                          <SelectItem value="As needed">As needed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="duration">Duration</Label>
                      <Input
                        id="duration"
                        value={medicationForm.duration}
                        onChange={(e) => handleMedicationFormChange('duration', e.target.value)}
                        placeholder="e.g., 7 days"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="instructions">Special Instructions</Label>
                    <Textarea
                      id="instructions"
                      value={medicationForm.instructions}
                      onChange={(e) => handleMedicationFormChange('instructions', e.target.value)}
                      placeholder="Enter any special instructions"
                      rows={2}
                    />
                  </div>
                  
                  <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                      id="urgent"
                      checked={medicationForm.urgent}
                      onCheckedChange={(checked) => handleMedicationFormChange('urgent', checked)}
                    />
                    <Label htmlFor="urgent" className="cursor-pointer">Mark as urgent</Label>
                  </div>
                  
                  <Button type="submit" className="w-full">Submit Medication Order</Button>
                </form>
              </CardContent>
            </Card>
            
            {/* Quick Order Buttons */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Common Medications</CardTitle>
                  <CardDescription>
                    Quick select common medications
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-2">
                    {commonMedications.map((med, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        className="justify-start"
                        onClick={() => handleQuickMedication(med)}
                      >
                        <Pill className="h-4 w-4 mr-2" />
                        {med.name} - {med.dose}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
              
              {/* Recent Orders */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Medication Orders</CardTitle>
                </CardHeader>
                <CardContent>
                  {medicationOrders.length > 0 ? (
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-2">
                        {medicationOrders.map(order => (
                          <div key={order.id} className="border rounded-md p-2">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium">{order.medication} {order.dose}</p>
                                <p className="text-sm text-muted-foreground">
                                  {order.route}, {order.frequency}
                                </p>
                              </div>
                              <Badge variant={order.urgent ? "destructive" : "outline"}>
                                {order.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              Ordered: {formatTimestamp(order.ordered_at)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No recent medication orders
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        
        {/* Lab Tests Tab */}
        <TabsContent value="labs" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Order Form */}
            <Card>
              <CardHeader>
                <CardTitle>Order Lab Test</CardTitle>
                <CardDescription>
                  Create a new lab test order for {patient.user.full_name}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLabOrderSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="test">Test Name</Label>
                    <Input
                      id="test"
                      value={labForm.test}
                      onChange={(e) => handleLabFormChange('test', e.target.value)}
                      placeholder="Enter test name"
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="specimen">Specimen Type</Label>
                    <Select
                      value={labForm.specimen}
                      onValueChange={(value) => handleLabFormChange('specimen', value)}
                    >
                      <SelectTrigger id="specimen">
                        <SelectValue placeholder="Select specimen type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Blood">Blood</SelectItem>
                        <SelectItem value="Urine">Urine</SelectItem>
                        <SelectItem value="CSF">CSF</SelectItem>
                        <SelectItem value="Stool">Stool</SelectItem>
                        <SelectItem value="Sputum">Sputum</SelectItem>
                        <SelectItem value="Swab">Swab</SelectItem>
                        <SelectItem value="Tissue">Tissue</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="lab-instructions">Special Instructions</Label>
                    <Textarea
                      id="lab-instructions"
                      value={labForm.instructions}
                      onChange={(e) => handleLabFormChange('instructions', e.target.value)}
                      placeholder="Enter any special instructions"
                      rows={2}
                    />
                  </div>
                  
                  <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                      id="lab-urgent"
                      checked={labForm.urgent}
                      onCheckedChange={(checked) => handleLabFormChange('urgent', checked)}
                    />
                    <Label htmlFor="lab-urgent" className="cursor-pointer">Mark as urgent</Label>
                  </div>
                  
                  <Button type="submit" className="w-full">Submit Lab Order</Button>
                </form>
              </CardContent>
            </Card>
            
            {/* Quick Order Buttons */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Common Lab Tests</CardTitle>
                  <CardDescription>
                    Quick select common lab tests
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-2">
                    {commonLabTests.map((test, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        className="justify-start"
                        onClick={() => handleQuickLabTest(test)}
                      >
                        <FlaskConical className="h-4 w-4 mr-2" />
                        {test.name}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
              
              {/* Recent Orders */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Lab Orders</CardTitle>
                </CardHeader>
                <CardContent>
                  {labOrders.length > 0 ? (
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-2">
                        {labOrders.map(order => (
                          <div key={order.id} className="border rounded-md p-2">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium">{order.test}</p>
                                <p className="text-sm text-muted-foreground">
                                  Specimen: {order.specimen}
                                </p>
                              </div>
                              <Badge variant={order.urgent ? "destructive" : "outline"}>
                                {order.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              Ordered: {formatTimestamp(order.ordered_at)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No recent lab orders
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        
        {/* Imaging Tab */}
        <TabsContent value="imaging" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Order Form */}
            <Card>
              <CardHeader>
                <CardTitle>Order Imaging Study</CardTitle>
                <CardDescription>
                  Create a new imaging study order for {patient.user.full_name}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleImagingOrderSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="study">Study Type</Label>
                    <Select
                      value={imagingForm.study}
                      onValueChange={(value) => handleImagingFormChange('study', value)}
                    >
                      <SelectTrigger id="study">
                        <SelectValue placeholder="Select study type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="X-ray">X-ray</SelectItem>
                        <SelectItem value="CT Scan">CT Scan</SelectItem>
                        <SelectItem value="MRI">MRI</SelectItem>
                        <SelectItem value="Ultrasound">Ultrasound</SelectItem>
                        <SelectItem value="Echocardiogram">Echocardiogram</SelectItem>
                        <SelectItem value="PET Scan">PET Scan</SelectItem>
                        <SelectItem value="Nuclear Medicine">Nuclear Medicine</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="bodyPart">Body Part</Label>
                    <Input
                      id="bodyPart"
                      value={imagingForm.bodyPart}
                      onChange={(e) => handleImagingFormChange('bodyPart', e.target.value)}
                      placeholder="Enter body part"
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="imaging-instructions">Special Instructions</Label>
                    <Textarea
                      id="imaging-instructions"
                      value={imagingForm.instructions}
                      onChange={(e) => handleImagingFormChange('instructions', e.target.value)}
                      placeholder="Enter any special instructions"
                      rows={2}
                    />
                  </div>
                  
                  <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                      id="contrast"
                      checked={imagingForm.contrast}
                      onCheckedChange={(checked) => handleImagingFormChange('contrast', checked)}
                    />
                    <Label htmlFor="contrast" className="cursor-pointer">With contrast</Label>
                  </div>
                  
                  <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                      id="imaging-urgent"
                      checked={imagingForm.urgent}
                      onCheckedChange={(checked) => handleImagingFormChange('urgent', checked)}
                    />
                    <Label htmlFor="imaging-urgent" className="cursor-pointer">Mark as urgent</Label>
                  </div>
                  
                  <Button type="submit" className="w-full">Submit Imaging Order</Button>
                </form>
              </CardContent>
            </Card>
            
            {/* Quick Order Buttons */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Common Imaging Studies</CardTitle>
                  <CardDescription>
                    Quick select common imaging studies
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-2">
                    {commonImagingStudies.map((study, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        className="justify-start"
                        onClick={() => handleQuickImagingStudy(study)}
                      >
                        <ImageIcon className="h-4 w-4 mr-2" />
                        {study.name} - {study.bodyPart}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
              
              {/* Recent Orders */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Imaging Orders</CardTitle>
                </CardHeader>
                <CardContent>
                  {imagingOrders.length > 0 ? (
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-2">
                        {imagingOrders.map(order => (
                          <div key={order.id} className="border rounded-md p-2">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium">{order.study}</p>
                                <p className="text-sm text-muted-foreground">
                                  {order.bodyPart} {order.contrast ? 'with contrast' : ''}
                                </p>
                              </div>
                              <Badge variant={order.urgent ? "destructive" : "outline"}>
                                {order.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              Ordered: {formatTimestamp(order.ordered_at)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No recent imaging orders
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}