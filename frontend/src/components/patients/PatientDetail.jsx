import { useState } from "react";
import { toast } from "sonner";
import format from "date-fns/format";

import { patientsApi } from '@/features/patients/api';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import {
  PatientDetailEmptyState,
  PatientDetailLayout,
} from './PatientDetailSections';

function getInitials(patient) {
  if (patient?.local_data?.user_details) {
    const firstName = patient.local_data.user_details.first_name || "";
    const lastName = patient.local_data.user_details.last_name || "";
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  } else if (patient?.fhir_resource?.name?.[0]) {
    const given = patient.fhir_resource.name[0].given?.[0] || "";
    const family = patient.fhir_resource.name[0].family || "";
    return `${given.charAt(0)}${family.charAt(0)}`.toUpperCase();
  }
  return "P";
}

function getDisplayName(patient) {
  if (patient?.local_data?.user_details) {
    return `${patient.local_data.user_details.first_name} ${patient.local_data.user_details.last_name}`;
  } else if (patient?.fhir_resource?.name?.[0]) {
    const given = patient.fhir_resource.name[0].given?.[0] || "";
    const family = patient.fhir_resource.name[0].family || "";
    return `${given} ${family}`;
  }
  return "Unknown Patient";
}

function getPatientDOB(patient) {
  const dob = patient.local_data?.user_details?.date_of_birth ||
             patient.fhir_resource?.birthDate;

  if (!dob) return "Unknown";

  try {
    return format(new Date(dob), "MMMM d, yyyy");
  } catch {
    return dob;
  }
}

function getPatientAge(patient) {
  const dob = patient.local_data?.user_details?.date_of_birth ||
             patient.fhir_resource?.birthDate;

  if (!dob) return "Unknown";

  try {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    return `${age} years`;
  } catch {
    return "Unknown";
  }
}

function getContactInfo(patient) {
  return {
    phone: patient.local_data?.user_details?.phone_number ||
           patient.fhir_resource?.telecom?.find(t => t.system === "phone")?.value ||
           "Not provided",
    email: patient.local_data?.user_details?.email ||
           patient.fhir_resource?.telecom?.find(t => t.system === "email")?.value ||
           "Not provided",
  };
}

function buildAddressDetails(address) {
  const lines = address.line || [];
  const city = address.city || "";
  const state = address.state || "";
  const postalCode = address.postalCode || "";
  const country = address.country || "";

  return {
    line1: lines[0] || "",
    line2: lines[1] || "",
    city,
    state,
    postalCode,
    country,
    formatted: [
      lines.join(", "),
      [city, state, postalCode].filter(Boolean).join(", "),
      country
    ].filter(Boolean).join("\n")
  };
}

function getAddress(patient) {
  if (patient.fhir_data?.address?.[0]) {
    return buildAddressDetails(patient.fhir_data.address[0]);
  }

  if (patient.fhir_resource?.address?.[0]) {
    return buildAddressDetails(patient.fhir_resource.address[0]);
  }

  return {
    line1: "",
    line2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    formatted: "No address provided"
  };
}

function getEmergencyContact(patient) {
  return {
    name: patient.local_data?.emergency_contact_name || "Not provided",
    phone: patient.local_data?.emergency_contact_phone || "Not provided",
    relationship: patient.local_data?.emergency_contact_relationship || "Not provided"
  };
}

function getPatientDisplayInfo(patient) {
  return {
    displayName: getDisplayName(patient),
    initials: getInitials(patient),
    dob: getPatientDOB(patient),
    age: getPatientAge(patient),
    contactInfo: getContactInfo(patient),
    address: getAddress(patient),
    emergencyContact: getEmergencyContact(patient),
    mrn: patient.local_data?.medical_record_number ||
         patient.fhir_resource?.identifier?.[0]?.value ||
         "No MRN",
    nhisId: patient.local_data?.nhis_id || "Not provided",
    bloodGroup: patient.local_data?.blood_group || "Unknown",
    allergies: patient.local_data?.allergies || "None reported",
  };
}

export default function PatientDetail({ patient, onBack, onEdit, onDeleted }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const patientDeletionAvailable = !isRustV2ApiMode();

  if (!patient) {
    return <PatientDetailEmptyState onBack={onBack} />;
  }

  const handleDeletePatient = async () => {
    if (!patientDeletionAvailable) {
      toast.error("Patient deletion is not available in Rust V2 mode.");
      return;
    }

    if (!patient.local_data?.id) {
      toast.error("Cannot delete patient without local ID");
      return;
    }

    setIsDeleting(true);
    try {
      await patientsApi.deletePatient(patient.local_data.id);
      toast.success("Patient deleted successfully");
      if (onDeleted) {
        onDeleted();
      }
    } catch (error) {
      console.error("Error deleting patient:", error);
      toast.error("Failed to delete patient");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <PatientDetailLayout
      info={getPatientDisplayInfo(patient)}
      isDeleting={isDeleting}
      onBack={onBack}
      onDeletePatient={handleDeletePatient}
      onEdit={onEdit}
      patientDeletionAvailable={patientDeletionAvailable}
    />
  );
}
