import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { usePatients, useSearchPatients } from "@/hooks/usePatientQueries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
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
import { Search, Plus, Loader2, Calendar as CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import { cn, normalizeApiResults } from "@/lib/utils";

const PatientList = ({ onPatientSelect, onAddPatient }) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWard, setSelectedWard] = useState("all");
  const [admissionDate, setAdmissionDate] = useState();
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

  // Fetch all patients (most recently registered first) with pagination
  const {
    data: allPatientsData,
    isLoading: isAllPatientsLoading
  } = usePatients();

  const getPatientId = (patient) => {
    // Check for ID in different data structures:
    // 1. Direct patient profile (from /users/patients/)
    if (patient?.id) {
      return patient.id;
    }
    // 2. Recent patients (from /patients/recent/)
    else if (patient?.patient_profile) {
      return patient.patient_profile;
    }
    // 3. Search results (from /patients/search/)
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
    // Check for simple name field first (from search API)
    if (patient?.name) {
      return patient.name;
    }
    // 1. Direct patient profile (from /users/patients/)
    if (patient?.user_details) {
      const { first_name, last_name } = patient.user_details;
      return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown Patient";
    }
    // 2. Recent patients (from /patients/recent/)
    else if (patient?.patient_profile_details?.user_details) {
      const { first_name, last_name } = patient.patient_profile_details.user_details;
      return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown Patient";
    }
    // 3. Search results (from /patients/search/)
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
    // 1. Direct patient profile (from /users/patients/)
    if (patient?.medical_record_number) {
      return patient.medical_record_number;
    }
    // 2. Recent patients (from /patients/recent/)
    else if (patient?.patient_profile_details?.medical_record_number) {
      return patient.patient_profile_details.medical_record_number;
    }
    // 3. Search results (from /patients/search/)
    return patient.local_data?.medical_record_number ||
      patient.fhir_data?.identifier?.[0]?.value ||
      patient.fhir_resource?.identifier?.[0]?.value ||
      "No MRN";
  };

  // Function to calculate age from date of birth
  const calculateAge = (dateOfBirth) => {
    if (!dateOfBirth) return null;

    try {
      const today = new Date();
      const birthDate = new Date(dateOfBirth);
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }

      return age;
    } catch (error) {
      return null;
    }
  };

  // Function to get patient age
  const getPatientAge = (patient) => {
    const dob = patient?.user_details?.date_of_birth ||
      patient?.patient_profile_details?.user_details?.date_of_birth ||
      patient?.local_data?.user_details?.date_of_birth ||
      patient?.fhir_data?.birthDate ||
      patient?.fhir_resource?.birthDate;

    const age = calculateAge(dob);
    return age !== null ? age : "Unknown";
  };

  // Function to get patient gender
  const getPatientGender = (patient) => {
    const gender = patient?.user_details?.gender ||
      patient?.patient_profile_details?.user_details?.gender ||
      patient?.local_data?.user_details?.gender;

    if (gender === 'M') return 'Male';
    if (gender === 'F') return 'Female';
    if (gender === 'O') return 'Other';
    return 'Unknown';
  };

  // Function to get patient NHIS number
  const getPatientNHIS = (patient) => {
    if (patient?.nhis_id) {
      return patient.nhis_id;
    }
    else if (patient?.patient_profile_details?.nhis_id) {
      return patient.patient_profile_details.nhis_id;
    }
    else if (patient?.local_data?.nhis_id) {
      return patient.local_data.nhis_id;
    }
    return null;
  };

  // Function to get admission date
  const getAdmissionDate = (patient) => {
    const admissionDate = patient?.admission_date ||
      patient?.patient_profile_details?.admission_date ||
      patient?.local_data?.admission_date;

    if (!admissionDate) return null;

    try {
      return format(new Date(admissionDate), "MMM d, yyyy");
    } catch (error) {
      return null;
    }
  };

  // Function to get patient initials for avatar
  const getInitials = (patient) => {
    // Check for simple name field first (from search API)
    if (patient?.name) {
      const parts = patient.name.trim().split(' ');
      if (parts.length >= 2) {
        return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
      }
      return patient.name.charAt(0).toUpperCase();
    }
    // 1. Direct patient profile (from /users/patients/)
    if (patient?.user_details) {
      const firstName = patient.user_details.first_name || "";
      const lastName = patient.user_details.last_name || "";
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "P";
    }
    // 2. Recent patients (from /patients/recent/)
    else if (patient?.patient_profile_details?.user_details) {
      const firstName = patient.patient_profile_details.user_details.first_name || "";
      const lastName = patient.patient_profile_details.user_details.last_name || "";
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "P";
    }
    // 3. Search results (from /patients/search/)
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

  // Function to get patient ward
  const getPatientWard = (patient) => {
    // 1. Direct patient profile (from /users/patients/) - includes current_ward
    if (patient?.current_ward) {
      return patient.current_ward;
    }
    // 2. Recent patients (from /patients/recent/)
    else if (patient?.patient_profile_details?.current_ward) {
      return patient.patient_profile_details.current_ward;
    }
    // 3. Search results (from /patients/search/)
    else if (patient?.local_data?.current_ward) {
      return patient.local_data.current_ward;
    }
    return null;
  };

  // Function to get patient ward ID
  const getPatientWardId = (patient) => {
    // 1. Direct patient profile (from /users/patients/) - includes current_ward_id
    if (patient?.current_ward_id) {
      return patient.current_ward_id;
    }
    // 2. Recent patients or search results might not have ward_id
    return null;
  };

  // Synchronize the local search input with the React Query hook
  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    updateSearch({ query });
  };


  const handleDateChange = (date) => {
    setAdmissionDate(date);
    updateSearch({ admission_date: date ? format(date, "yyyy-MM-dd") : "" });
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedWard("all");
    setAdmissionDate(undefined);
    setSearchTerm(""); // Reset search term to empty string/object
  };

  const updateSearch = (updates) => {
    // Construct the new search object
    const currentSearch = typeof searchTerm === 'object' ? searchTerm : { query: searchTerm };
    const newSearch = {
      ...currentSearch,
      ...updates,
      // Ensure query is always present
      query: updates.query !== undefined ? updates.query : searchQuery
    };

    // If ward is "all", remove it
    if (newSearch.ward === "all") newSearch.ward = "";

    setSearchTerm(newSearch);
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
    ? normalizeApiResults(searchResults)
    : normalizeApiResults(allPatientsData);

  // Ensure displayedPatients is always an array (normalizeApiResults already guarantees this)
  const safeDisplayedPatients = displayedPatients;

  // Extract unique wards from patient data for filter dropdown
  const uniqueWards = safeDisplayedPatients.reduce((wards, patient) => {
    const wardId = patient?.current_ward_id;
    const wardName = getPatientWard(patient);

    if (wardId && wardName && wardName !== "Waiting List") {
      // Check if this ward is already in the list
      if (!wards.find(w => w.id === wardId)) {
        wards.push({ id: wardId, name: wardName });
      }
    }
    return wards;
  }, []);

  // Client-side filtering when ward is selected
  const filteredPatients = selectedWard === "all"
    ? safeDisplayedPatients
    : safeDisplayedPatients.filter(patient => patient?.current_ward_id === selectedWard);

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
        <div className="mb-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search patients by name, MRN, or NHIS ID..."
                value={searchQuery}
                onChange={handleSearchChange}
                className="pl-10"
              />
            </div>

            <Select value={selectedWard} onValueChange={setSelectedWard}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="Filter by Ward" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Wards</SelectItem>
                {uniqueWards.map((ward) => (
                  <SelectItem key={ward.id} value={ward.id}>
                    {ward.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-full md:w-[240px] justify-start text-left font-normal",
                    !admissionDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {admissionDate ? format(admissionDate, "PPP") : <span>Filter by Admission Date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={admissionDate}
                  onSelect={handleDateChange}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            {(searchQuery || selectedWard !== "all" || admissionDate) && (
              <Button variant="ghost" onClick={clearFilters} className="px-3">
                <X className="mr-2 h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {isSearchLoading || isAllPatientsLoading ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>MRN / NHIS</TableHead>
                  <TableHead>Age & Gender</TableHead>
                  <TableHead>Ward</TableHead>
                  <TableHead>Date Admitted</TableHead>
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
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
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
              : "No patients registered yet."}
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>MRN / NHIS</TableHead>
                    <TableHead>Age & Gender</TableHead>
                    <TableHead>Ward</TableHead>
                    <TableHead>Date Admitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPatients.map((patient) => {
                    const patientId = getPatientId(patient);
                    const displayName = getDisplayName(patient);
                    const initials = getInitials(patient);
                    const mrn = getPatientMRN(patient);
                    const nhis = getPatientNHIS(patient);
                    const age = getPatientAge(patient);
                    const gender = getPatientGender(patient);
                    const ward = getPatientWard(patient);
                    const wardLabel = ward || "Not Admitted";
                    const isWaitingList = ward === "Waiting List";
                    const isNotAdmitted = !ward;
                    const admissionDate = getAdmissionDate(patient);

                    return (
                      <TableRow
                        key={patientId}
                        onClick={() => handleSelectPatient(patient)}
                        className="cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center">
                            <Avatar className="h-8 w-8 mr-2">
                              <AvatarFallback>{initials}</AvatarFallback>
                            </Avatar>
                            <span>{displayName}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">{mrn}</span>
                            {nhis && <span className="text-xs text-muted-foreground">NHIS: {nhis}</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span>{age} yrs</span>
                            <span className="text-xs text-muted-foreground">{gender}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                            isNotAdmitted ? "bg-gray-100 text-gray-800" :
                              isWaitingList ? "bg-yellow-100 text-yellow-800" :
                                "bg-green-100 text-green-800"
                          )}>
                            {wardLabel}
                          </span>
                        </TableCell>
                        <TableCell>
                          {admissionDate || <span className="text-muted-foreground">-</span>}
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
