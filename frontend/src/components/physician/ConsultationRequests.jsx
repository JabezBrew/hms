import MessageSquare from 'lucide-react/dist/esm/icons/message-square.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import format from 'date-fns/format';

export function ConsultationRequests({ patient }) {
  const [consultations, setConsultations] = useState([]);
  const [formData, setFormData] = useState({
    specialtyType: '',
    reason: '',
    urgency: 'routine',
    additionalInfo: '',
    preferredConsultant: ''
  });

  // Common specialties for quick selection
  const commonSpecialties = [
    { name: 'Cardiology', reason: 'Cardiac evaluation' },
    { name: 'Neurology', reason: 'Neurological assessment' },
    { name: 'Pulmonology', reason: 'Respiratory evaluation' },
    { name: 'Infectious Disease', reason: 'Infection management' },
    { name: 'Nephrology', reason: 'Renal function assessment' }
  ];

  // Handle form input changes
  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Handle quick selection of common specialty
  const handleQuickSpecialty = (specialty) => {
    setFormData({
      ...formData,
      specialtyType: specialty.name,
      reason: specialty.reason
    });
  };

  // Submit consultation request
  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validate form
    if (!formData.specialtyType || !formData.reason) {
      alert('Please fill in all required fields');
      return;
    }
    
    // Create new consultation request
    const newConsultation = {
      id: `consult-${Date.now()}`,
      patient: patient.id,
      specialty: formData.specialtyType,
      reason: formData.reason,
      urgency: formData.urgency,
      additional_info: formData.additionalInfo,
      preferred_consultant: formData.preferredConsultant,
      status: 'pending',
      requested_by: 'Current Doctor',
      requested_at: new Date().toISOString(),
      completed_at: null,
      consultant: null,
      findings: null
    };
    
    // Add to consultations list
    setConsultations([newConsultation, ...consultations]);
    
    // Reset form
    setFormData({
      specialtyType: '',
      reason: '',
      urgency: 'routine',
      additionalInfo: '',
      preferredConsultant: ''
    });
    
    // Show success message
    alert('Consultation request submitted successfully');
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    return format(new Date(timestamp), 'MMM d, yyyy h:mm a');
  };

  // Get urgency badge
  const getUrgencyBadge = (urgency) => {
    switch (urgency) {
      case 'stat':
        return <Badge variant="destructive">STAT</Badge>;
      case 'urgent':
        return <Badge variant="warning">Urgent</Badge>;
      case 'routine':
        return <Badge variant="outline">Routine</Badge>;
      default:
        return <Badge variant="outline">{urgency}</Badge>;
    }
  };

  // Get status badge
  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline">Pending</Badge>;
      case 'scheduled':
        return <Badge variant="warning">Scheduled</Badge>;
      case 'in_progress':
        return <Badge variant="info">In Progress</Badge>;
      case 'completed':
        return <Badge variant="success">Completed</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Request Form */}
        <Card>
          <CardHeader>
            <CardTitle>Request Consultation</CardTitle>
            <CardDescription>
              Request a specialist consultation for {patient.user.full_name}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="specialtyType">Specialty</Label>
                <Select
                  value={formData.specialtyType}
                  onValueChange={(value) => handleInputChange('specialtyType', value)}
                >
                  <SelectTrigger id="specialtyType">
                    <SelectValue placeholder="Select specialty" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cardiology">Cardiology</SelectItem>
                    <SelectItem value="Neurology">Neurology</SelectItem>
                    <SelectItem value="Pulmonology">Pulmonology</SelectItem>
                    <SelectItem value="Gastroenterology">Gastroenterology</SelectItem>
                    <SelectItem value="Endocrinology">Endocrinology</SelectItem>
                    <SelectItem value="Nephrology">Nephrology</SelectItem>
                    <SelectItem value="Hematology">Hematology</SelectItem>
                    <SelectItem value="Oncology">Oncology</SelectItem>
                    <SelectItem value="Infectious Disease">Infectious Disease</SelectItem>
                    <SelectItem value="Rheumatology">Rheumatology</SelectItem>
                    <SelectItem value="Psychiatry">Psychiatry</SelectItem>
                    <SelectItem value="Surgery">Surgery</SelectItem>
                    <SelectItem value="Orthopedics">Orthopedics</SelectItem>
                    <SelectItem value="Urology">Urology</SelectItem>
                    <SelectItem value="Dermatology">Dermatology</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="reason">Reason for Consultation</Label>
                <Textarea
                  id="reason"
                  value={formData.reason}
                  onChange={(e) => handleInputChange('reason', e.target.value)}
                  placeholder="Describe the reason for consultation"
                  rows={3}
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="urgency">Urgency</Label>
                <Select
                  value={formData.urgency}
                  onValueChange={(value) => handleInputChange('urgency', value)}
                >
                  <SelectTrigger id="urgency">
                    <SelectValue placeholder="Select urgency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="routine">Routine</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="stat">STAT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="preferredConsultant">Preferred Consultant (Optional)</Label>
                <Input
                  id="preferredConsultant"
                  value={formData.preferredConsultant}
                  onChange={(e) => handleInputChange('preferredConsultant', e.target.value)}
                  placeholder="Enter name if you have a preference"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="additionalInfo">Additional Information</Label>
                <Textarea
                  id="additionalInfo"
                  value={formData.additionalInfo}
                  onChange={(e) => handleInputChange('additionalInfo', e.target.value)}
                  placeholder="Any additional information for the consultant"
                  rows={2}
                />
              </div>
              
              <Button type="submit" className="w-full">Submit Consultation Request</Button>
            </form>
          </CardContent>
        </Card>
        
        {/* Quick Request Buttons */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Common Consultations</CardTitle>
              <CardDescription>
                Quick select common consultation types
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2">
                {commonSpecialties.map((specialty) => (
                  <Button
                    key={specialty.name}
                    variant="outline"
                    className="justify-start"
                    onClick={() => handleQuickSpecialty(specialty)}
                  >
                    <MessageSquare className="size-4 mr-2" />
                    {specialty.name}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      
      {/* Consultation History */}
      <Card>
        <CardHeader>
          <CardTitle>Consultation History</CardTitle>
          <CardDescription>
            Previous and pending consultations for {patient.user.full_name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {consultations.length > 0 ? (
            <ScrollArea className="h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date Requested</TableHead>
                    <TableHead>Specialty</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Urgency</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Consultant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consultations.map(consultation => (
                    <TableRow key={consultation.id}>
                      <TableCell>{formatTimestamp(consultation.requested_at)}</TableCell>
                      <TableCell>{consultation.specialty}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{consultation.reason}</TableCell>
                      <TableCell>{getUrgencyBadge(consultation.urgency)}</TableCell>
                      <TableCell>{getStatusBadge(consultation.status)}</TableCell>
                      <TableCell>{consultation.consultant || 'Not assigned'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            <div className="text-center py-8">
              <MessageSquare className="size-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium">No consultation history</p>
              <p className="text-muted-foreground">
                No consultations have been requested for this patient yet.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Sample Consultation Findings (would be shown when a consultation is selected) */}
      {consultations.length > 0 && consultations.some(c => c.status === 'completed') && (
        <Card>
          <CardHeader>
            <CardTitle>Consultation Findings</CardTitle>
            <CardDescription>
              Results from completed consultations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {consultations
                .filter(c => c.status === 'completed')
                .map(consultation => (
                  <div key={`findings-${consultation.id}`} className="border rounded-md p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-medium">{consultation.specialty} Consultation</h3>
                        <p className="text-sm text-muted-foreground">
                          {formatTimestamp(consultation.completed_at || consultation.requested_at)}
                        </p>
                      </div>
                      <Badge variant="success">Completed</Badge>
                    </div>
                    <p className="text-sm mt-2">
                      {consultation.findings || 'No findings recorded for this consultation.'}
                    </p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
