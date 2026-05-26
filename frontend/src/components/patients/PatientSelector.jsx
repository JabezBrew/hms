import Check from 'lucide-react/dist/esm/icons/check.js';
import ChevronsUpDown from 'lucide-react/dist/esm/icons/chevrons-up-down.js';
import { useState, useEffect, useCallback, useId } from "react";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/use-debounce";
import { normalizeApiResults } from "@/lib/utils";
import { patientsApi } from '@/features/patients/api';
import { Button } from "@/components/ui/button";
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

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";

const PatientSelector = ({ onPatientSelect, selectedPatient, placeholder = "Select a patient" }) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [patients, setPatients] = useState([]);
  const listboxId = useId();
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

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
    // Check for simple name field first (from search API)
    if (patient?.name) {
      return patient.name;
    }
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
    // Check for direct id first (from search API)
    if (patient?.id) {
      return patient.id;
    }
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
      const response = await patientsApi.searchPatients({ query });
      setPatients(normalizeApiResults(response));
    } catch (error) {
      console.error("Error searching patients:", error);
      toast.error("Failed to search patients");
      setPatients([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
            aria-controls={listboxId}
            aria-haspopup="listbox"
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
        <PopoverContent
          className="p-0 z-[200]"
          align="start"
          style={{ width: 'var(--radix-popover-trigger-width)' }}
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search patients..."
              value={searchQuery}
              onValueChange={setSearchQuery}
              className="h-9"
            />
            {isLoading ? (
              <CommandList id={listboxId}>
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
              <CommandList id={listboxId}>
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
                    const mrn = patient.medical_record_number ||
                                patient.local_data?.medical_record_number ||
                                patient.fhir_resource?.identifier?.[0]?.value ||
                                "No MRN";

                    return (
                      <CommandItem
                        key={patientId}
                        value={displayName}
                        onSelect={() => handleSelectPatient(patient)}
                        className="flex items-center cursor-pointer"
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
