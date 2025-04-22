import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { usePatients, useRecentPatients, useSearchPatients } from "@/hooks/usePatientQueries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, Loader2 } from "lucide-react";
import { format } from "date-fns";

const PatientList = ({ onPatientSelect, onAddPatient }) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const patientsPerPage = 10;

  // Use React Query hooks for data fetching
  const { 
    data: searchResults,
    isLoading: isSearchLoading,
    searchTerm,
    setSearchTerm,
    debouncedSearchTerm
  } = useSearchPatients();

  const {
    data: recentPatientsData,
    isLoading: isRecentLoading
  } = useRecentPatients();

  const getPatientId = (patient) => {
    // First check for patient profile ID (for recent patients)
    if (patient?.patient_profile) {
      return patient.patient_profile;
    }
    // Then check for ID in the patient object itself
    else if (patient?.id) {
      return patient.id;
    }
    // Then check the old paths
    else if (patient?.local_data?.id) {
      return patient.local_data.id;
    } else if (patient?.fhir_data?.id) {
      return patient.fhir_data.id;
    } else if (patient?.fhir_resource?.id) {
      return patient.fhir_resource.id;
    }
    // If no ID is found, generate a unique key to avoid React warnings
    return `patient-${Math.random().toString(36).substr(2, 9)}`;
  };

// Function to get patient display name
  const getDisplayName = (patient) => {
    // Check for name in patient_profile_details first (for recent patients)
    if (patient?.patient_profile_details?.user_details) {
      const { first_name, last_name } = patient.patient_profile_details.user_details;
      return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown Patient";
    }
    // Then check the old paths
    else if (patient?.local_data?.user_details) {
      return `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim() || "Unknown Patient";
    } else if (patient?.fhir_resource?.name?.[0]) {
      const given = patient.fhir_resource.name[0].given?.[0] || "";
      const family = patient.fhir_resource.name[0].family || "";
      return `${given} ${family}`.trim() || "Unknown Patient";
    }
    return "Unknown Patient";
  };

// Function to get patient MRN
  const getPatientMRN = (patient) => {
    // Check for MRN in patient_profile_details first (for recent patients)
    if (patient?.patient_profile_details?.medical_record_number) {
      return patient.patient_profile_details.medical_record_number;
    }
    // Then check the old paths
    return patient.local_data?.medical_record_number ||
        patient.fhir_data?.identifier?.[0]?.value ||
        patient.fhir_resource?.identifier?.[0]?.value ||
        "No MRN";
  };

// Function to get patient date of birth
  const getPatientDOB = (patient) => {
    // Check for DOB in patient_profile_details first (for recent patients)
    const dob = patient?.patient_profile_details?.user_details?.date_of_birth ||
        patient?.local_data?.user_details?.date_of_birth ||
        patient?.fhir_data?.birthDate ||
        patient?.fhir_resource?.birthDate;

    if (!dob) return "Unknown";

    try {
      return format(new Date(dob), "MMM d, yyyy");
    } catch (error) {
      return dob;
    }
  };

// Function to get patient initials for avatar
  const getInitials = (patient) => {
    // Check for name in patient_profile_details first (for recent patients)
    if (patient?.patient_profile_details?.user_details) {
      const firstName = patient.patient_profile_details.user_details.first_name || "";
      const lastName = patient.patient_profile_details.user_details.last_name || "";
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "P";
    }
    // Then check the old paths
    else if (patient?.local_data?.user_details) {
      const firstName = patient.local_data.user_details.first_name || "";
      const lastName = patient.local_data.user_details.last_name || "";
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "P";
    } else if (patient?.fhir_resource?.name?.[0]) {
      const given = patient.fhir_resource.name[0].given?.[0] || "";
      const family = patient.fhir_resource.name[0].family || "";
      return `${given.charAt(0)}${family.charAt(0)}`.toUpperCase() || "P";
    }
    return "P";
  };

  // Synchronize the local search input with the React Query hook
  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    setSearchTerm(e.target.value);
  };

  // Handle patient selection
  const handleSelectPatient = (patient) => {
    const patientId = getPatientId(patient);
    if (patientId) {
      navigate(`/patients/${patientId}`);
    } else if (onPatientSelect) {
      // Fallback to the old behavior if navigation is not possible
      onPatientSelect(patient);
    }
  };

  // Handle add patient
  const handleAddPatient = () => {
    // If we have a route for creating patients, navigate to it
    if (navigate) {
      navigate('/patients/create');
    } else if (onAddPatient) {
      // Fallback to the old behavior
      onAddPatient();
    }
  };

  // Calculate pagination and prepare data for display
  const totalPatients = searchResults?.total || 0;
  const totalPages = Math.ceil(totalPatients / patientsPerPage);

  // Determine which data to display based on search state
  const displayedPatients = debouncedSearchTerm 
    ? (searchResults?.results || searchResults?.patients || []) 
    : (recentPatientsData?.results || recentPatientsData?.patients || recentPatientsData || []);

  // Ensure displayedPatients is always an array
  const safeDisplayedPatients = Array.isArray(displayedPatients) ? displayedPatients : [];

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Patients</CardTitle>
        <Button onClick={handleAddPatient}>
          <Plus className="mr-2 h-4 w-4" />
          Add Patient
        </Button>
      </CardHeader>
      <CardContent>
        <div className="mb-4 relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search patients by name, MRN, or NHIS ID..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="pl-10"
          />
        </div>

        {isSearchLoading || isRecentLoading ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>MRN</TableHead>
                  <TableHead>Date of Birth</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={`skeleton-row-${index}`}>
                    <TableCell>
                      <div className="flex items-center">
                        <Skeleton className="h-8 w-8 rounded-full mr-2" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="h-8 w-16 ml-auto" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : safeDisplayedPatients.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {debouncedSearchTerm 
              ? "No patients found matching your search criteria" 
              : "No recent patients. Search to find patients."}
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>MRN</TableHead>
                    <TableHead>Date of Birth</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {safeDisplayedPatients.map((patient) => {
                    const patientId = getPatientId(patient);
                    const displayName = getDisplayName(patient);
                    const initials = getInitials(patient);
                    const mrn = getPatientMRN(patient);
                    const dob = getPatientDOB(patient);

                    return (
                      <TableRow key={patientId}>
                        <TableCell className="font-medium">
                          <div className="flex items-center">
                            <Avatar className="h-8 w-8 mr-2">
                              <AvatarFallback>{initials}</AvatarFallback>
                            </Avatar>
                            <span>{displayName}</span>
                          </div>
                        </TableCell>
                        <TableCell>{mrn}</TableCell>
                        <TableCell>{dob}</TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleSelectPatient(patient)}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {debouncedSearchTerm && totalPages > 1 && (
              <Pagination className="mt-4">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                    />
                  </PaginationItem>

                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const pageNumber = i + 1;
                    return (
                      <PaginationItem key={pageNumber}>
                        <PaginationLink
                          isActive={pageNumber === currentPage}
                          onClick={() => setCurrentPage(pageNumber)}
                        >
                          {pageNumber}
                        </PaginationLink>
                      </PaginationItem>
                    );
                  })}

                  <PaginationItem>
                    <PaginationNext 
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default PatientList;
