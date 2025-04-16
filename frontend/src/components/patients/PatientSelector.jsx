import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useDebounce } from "@/hooks/use-debounce";
import { Toaster } from "@/components/ui/sonner.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";

const PatientSelector = ({ onPatientSelect, selectedPatient, placeholder = "Select a patient" }) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [patients, setPatients] = useState([]);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Function to get patient initials for avatar
  const getInitials = (patient) => {
    if (patient?.local_data?.user) {
      const firstName = patient.local_data.user.first_name || "";
      const lastName = patient.local_data.user.last_name || "";
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    } else if (patient?.fhir_resource?.name?.[0]) {
      const given = patient.fhir_resource.name[0].given?.[0] || "";
      const family = patient.fhir_resource.name[0].family || "";
      return `${given.charAt(0)}${family.charAt(0)}`.toUpperCase();
    }
    return "P";
  };

  // Function to get patient display name
  const getDisplayName = (patient) => {
    if (patient?.local_data?.user) {
      return `${patient.local_data.user.first_name} ${patient.local_data.user.last_name}`;
    } else if (patient?.fhir_resource?.name?.[0]) {
      const given = patient.fhir_resource.name[0].given?.[0] || "";
      const family = patient.fhir_resource.name[0].family || "";
      return `${given} ${family}`;
    }
    return "Unknown Patient";
  };

  // Function to get patient ID
  const getPatientId = (patient) => {
    if (patient?.local_data?.id) {
      return patient.local_data.id;
    } else if (patient?.fhir_resource?.id) {
      return patient.fhir_resource.id;
    }
    return null;
  };

  // Function to search patients
  const searchPatients = useCallback(async (query) => {
    if (!query || query.length < 2) {
      setPatients([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await axios.get(`/api/patients/search/?query=${encodeURIComponent(query)}`);
      setPatients(response.data.patients || []);
    } catch (error) {
      console.error("Error searching patients:", error);
      Toaster({
        title: "Error",
        description: "Failed to search patients",
        variant: "destructive",
      });
      setPatients([]);
    } finally {
      setIsLoading(false);
    }
  }, [Toaster]);

  // Effect to search patients when query changes
  useEffect(() => {
    searchPatients(debouncedSearchQuery);
  }, [debouncedSearchQuery, searchPatients]);

  // Handle patient selection
  const handleSelectPatient = (patient) => {
    if (onPatientSelect) {
      onPatientSelect(patient);
    }
    setOpen(false);
  };

  // Get display name for selected patient
  const selectedPatientName = selectedPatient ? getDisplayName(selectedPatient) : "";

  return (
    <div className="flex flex-col space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            {selectedPatient ? (
              <div className="flex items-center">
                <Avatar className="h-6 w-6 mr-2">
                  <AvatarFallback>{getInitials(selectedPatient)}</AvatarFallback>
                </Avatar>
                <span>{selectedPatientName}</span>
              </div>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0">
          <Command>
            <CommandInput
              placeholder="Search patients..."
              value={searchQuery}
              onValueChange={setSearchQuery}
              className="h-9"
            />
            {isLoading ? (
              <CommandList>
                <CommandGroup>
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={`skeleton-item-${index}`} className="flex items-center p-2">
                      <Skeleton className="h-6 w-6 rounded-full mr-2" />
                      <div className="flex flex-col flex-1">
                        <Skeleton className="h-4 w-32 mb-1" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  ))}
                </CommandGroup>
              </CommandList>
            ) : (
              <CommandList>
                <CommandEmpty>
                  {searchQuery.length < 2 
                    ? "Type at least 2 characters to search" 
                    : "No patients found"}
                </CommandEmpty>
                <CommandGroup>
                  {patients.map((patient) => {
                    const patientId = getPatientId(patient);
                    const displayName = getDisplayName(patient);
                    const initials = getInitials(patient);
                    const mrn = patient.local_data?.medical_record_number || 
                                patient.fhir_resource?.identifier?.[0]?.value || 
                                "No MRN";

                    return (
                      <CommandItem
                        key={patientId}
                        value={patientId}
                        onSelect={() => handleSelectPatient(patient)}
                        className="flex items-center"
                      >
                        <Avatar className="h-6 w-6 mr-2">
                          <AvatarFallback>{initials}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span>{displayName}</span>
                          <span className="text-xs text-muted-foreground">MRN: {mrn}</span>
                        </div>
                        {selectedPatient && getPatientId(selectedPatient) === patientId && (
                          <Check className="ml-auto h-4 w-4" />
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default PatientSelector;
