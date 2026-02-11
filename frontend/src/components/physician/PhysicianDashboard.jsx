import Search from 'lucide-react/dist/esm/icons/search.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.js';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { admissionsApi } from '@/features/admissions/api';
import { wardsApi } from '@/features/wards/api';

import { PatientList } from './PatientList';
import { WardRoundTools } from './WardRoundTools';
import { OrderEntry } from './OrderEntry';
import { ConsultationRequests } from './ConsultationRequests';

export function PhysicianDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [wards, setWards] = useState([]);
  const [selectedWard, setSelectedWard] = useState('');
  const [patients, setPatients] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [activeTab, setActiveTab] = useState('patients');

  // Fetch wards
  useEffect(() => {
    const fetchWards = async () => {
      try {
        const data = await wardsApi.getWardsRoot();
        setWards(data);
        if (data.length > 0) {
          setSelectedWard(data[0].id);
        }
        setLoading(false);
      } catch (err) {
        console.error('Error fetching wards:', err);
        setError('Failed to load wards. Please try again.');
        setLoading(false);
      }
    };

    fetchWards();
  }, []);

  // Fetch patients when ward changes
  useEffect(() => {
    if (!selectedWard) return;

    const fetchPatients = async () => {
      try {
        setLoading(true);
        // Get all admissions for the selected ward
        const admissionsData = await admissionsApi.getAdmissions({ ward: selectedWard, status: 'admitted' });

        // Extract patient information from admissions
        const patientData = admissionsData.map(admission => ({
          ...admission.patient,
          admission: admission,
          bed: admission.bed
        }));

        setPatients(patientData);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching patients:', err);
        setError('Failed to load patients. Please try again.');
        setLoading(false);
      }
    };

    fetchPatients();
  }, [selectedWard]);

  // Filter patients based on search term
  const filteredPatients = patients.filter(patient => 
    patient.user.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.bed.bed_number.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Handle ward change
  const handleWardChange = (wardId) => {
    setSelectedWard(wardId);
    setSelectedPatient(null);
  };

  // Handle patient selection
  const handlePatientSelect = (patient) => {
    setSelectedPatient(patient);
    setActiveTab('wardRound');
  };

  // Handle tab change
  const handleTabChange = (value) => {
    setActiveTab(value);
  };

  if (loading && !selectedPatient) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !selectedPatient) {
    return (
      <Card className="m-4">
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
    <div className="space-y-6 p-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-2xl font-bold">Physician Care Dashboard</h1>

        {/* Ward selector */}
        <div className="w-full md:w-64">
          <Select
            value={selectedWard}
            onValueChange={handleWardChange}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select ward" />
            </SelectTrigger>
            <SelectContent>
              {wards.map(ward => (
                <SelectItem key={ward.id} value={ward.id}>
                  {ward.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedPatient ? (
        <div className="space-y-6">
          {/* Patient header */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle>{selectedPatient.user.full_name}</CardTitle>
                  <CardDescription>
                    {selectedPatient.bed.ward.name} - Bed {selectedPatient.bed.bed_number}
                  </CardDescription>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setSelectedPatient(null)}
                >
                  Back to Patient List
                </Button>
              </div>
            </CardHeader>
          </Card>

          {/* Patient care tabs */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="grid grid-cols-3">
              <TabsTrigger value="wardRound">
                <Stethoscope className="h-4 w-4 mr-2" />
                Ward Round
              </TabsTrigger>
              <TabsTrigger value="orders">
                <ClipboardList className="h-4 w-4 mr-2" />
                Orders
              </TabsTrigger>
              <TabsTrigger value="consultations">
                <MessageSquare className="h-4 w-4 mr-2" />
                Consultations
              </TabsTrigger>
            </TabsList>

            <TabsContent value="wardRound" className="mt-4">
              <WardRoundTools patient={selectedPatient} />
            </TabsContent>

            <TabsContent value="orders" className="mt-4">
              <OrderEntry patient={selectedPatient} />
            </TabsContent>

            <TabsContent value="consultations" className="mt-4">
              <ConsultationRequests patient={selectedPatient} />
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search patients by name or bed number..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Patient list */}
          <PatientList 
            patients={filteredPatients} 
            onPatientSelect={handlePatientSelect} 
          />
        </div>
      )}
    </div>
  );
}
