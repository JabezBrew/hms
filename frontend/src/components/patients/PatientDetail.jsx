import { useState } from "react";
import { toast } from "sonner";
import { patientsApi } from "@/lib/api/patients";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { 
  User, 
  Phone, 
  Mail, 
  Calendar, 
  Home, 
  Activity, 
  AlertTriangle, 
  Edit, 
  Trash2, 
  ArrowLeft,
  FileText,
  Heart,
  Droplet
} from "lucide-react";

const PatientDetail = ({ patient, onBack, onEdit, onDeleted }) => {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!patient) {
    return (
      <Card className="w-full">
        <CardContent className="pt-6 text-center">
          <p className="text-muted-foreground">No patient selected</p>
          <Button variant="outline" className="mt-4" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Patient List
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Function to get patient initials for avatar
  const getInitials = () => {
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
  };

  // Function to get patient display name
  const getDisplayName = () => {
    if (patient?.local_data?.user_details) {
      return `${patient.local_data.user_details.first_name} ${patient.local_data.user_details.last_name}`;
    } else if (patient?.fhir_resource?.name?.[0]) {
      const given = patient.fhir_resource.name[0].given?.[0] || "";
      const family = patient.fhir_resource.name[0].family || "";
      return `${given} ${family}`;
    }
    return "Unknown Patient";
  };

  // Function to get patient date of birth
  const getPatientDOB = () => {
    const dob = patient.local_data?.user_details?.date_of_birth || 
               patient.fhir_resource?.birthDate;

    if (!dob) return "Unknown";

    try {
      return format(new Date(dob), "MMMM d, yyyy");
    } catch (error) {
      return dob;
    }
  };

  // Function to get patient age
  const getPatientAge = () => {
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
    } catch (error) {
      return "Unknown";
    }
  };

  // Function to get patient contact information
  const getContactInfo = () => {
    return {
      phone: patient.local_data?.user_details?.phone_number || 
             patient.fhir_resource?.telecom?.find(t => t.system === "phone")?.value || 
             "Not provided",
      email: patient.local_data?.user_details?.email || 
             patient.fhir_resource?.telecom?.find(t => t.system === "email")?.value || 
             "Not provided",
    };
  };

  // Function to get patient address
  const getAddress = () => {
    if (patient.fhir_data?.address?.[0]) {
      const address = patient.fhir_data.address[0];
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

    if (patient.fhir_resource?.address?.[0]) {
      const address = patient.fhir_resource.address[0];
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

    return {
      line1: "",
      line2: "",
      city: "",
      state: "",
      postalCode: "",
      country: "",
      formatted: "No address provided"
    };
  };

  // Function to get emergency contact
  const getEmergencyContact = () => {
    return {
      name: patient.local_data?.emergency_contact_name || "Not provided",
      phone: patient.local_data?.emergency_contact_phone || "Not provided",
      relationship: patient.local_data?.emergency_contact_relationship || "Not provided"
    };
  };

  // Function to handle patient deletion
  const handleDeletePatient = async () => {
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

  // Get all the patient information
  const displayName = getDisplayName();
  const initials = getInitials();
  const dob = getPatientDOB();
  const age = getPatientAge();
  const contactInfo = getContactInfo();
  const address = getAddress();
  const emergencyContact = getEmergencyContact();
  const mrn = patient.local_data?.medical_record_number || 
              patient.fhir_resource?.identifier?.[0]?.value || 
              "No MRN";
  const nhisId = patient.local_data?.nhis_id || "Not provided";
  const bloodGroup = patient.local_data?.blood_group || "Unknown";
  const allergies = patient.local_data?.allergies || "None reported";

  const isNegativeAllergy = (allergyText) => {
    if (!allergyText) return true;

    // Convert to lowercase for case-insensitive comparison
    const text = allergyText.toLowerCase().trim();

    // Array of common negative responses
    const negativeResponses = [
      'none',
      'no',
      'nothing',
      'nil',
      'nill',
      'n/a',
      'na',
      'not applicable',
      'none reported',
      'no allergies',
      'no known allergies',
      'no known drug allergies',
      'nkda'
    ];

    // Check if the text matches any negative response
    return negativeResponses.some(response =>
        text === response || text.includes(response)
    );
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <div className="flex flex-col">
            <Button variant="outline" size="sm" className="mb-2 w-fit" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <div className="flex items-center pl-0">
              <Avatar className="h-12 w-12 mr-4">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-2xl">{displayName}</CardTitle>
                <CardDescription className="flex items-center mt-1">
                  <FileText className="h-4 w-4 mr-1" />
                  MRN: {mrn}
                  {nhisId !== "Not provided" && (
                    <Badge variant="outline" className="ml-2">
                      NHIS: {nhisId}
                    </Badge>
                  )}
                </CardDescription>
              </div>
            </div>
          </div>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the patient
                  record and all associated data.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={handleDeletePatient}
                  disabled={isDeleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="medical">Medical Information</TabsTrigger>
            <TabsTrigger value="contact">Contact Information</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center">
                    <User className="h-5 w-5 mr-2" />
                    Personal Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Full Name:</span>
                    <span className="font-medium">{displayName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date of Birth:</span>
                    <span className="font-medium">{dob}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Age:</span>
                    <span className="font-medium">{age}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">MRN:</span>
                    <span className="font-medium">{mrn}</span>
                  </div>
                  {nhisId !== "Not provided" && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">NHIS ID:</span>
                      <span className="font-medium">{nhisId}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center">
                    <Phone className="h-5 w-5 mr-2" />
                    Contact Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Phone:</span>
                    <span className="font-medium">{contactInfo.phone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email:</span>
                    <span className="font-medium">{contactInfo.email}</span>
                  </div>
                  <Separator className="my-2" />
                  <div>
                    <span className="text-muted-foreground">Address:</span>
                    <p className="font-medium whitespace-pre-line mt-1">{address.formatted}</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center">
                  <Activity className="h-5 w-5 mr-2" />
                  Medical Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-start">
                  <Droplet className="h-5 w-5 mr-2 text-primary" />
                  <div>
                    <span className="font-medium">Blood Group:</span>
                    <span className="ml-2">{bloodGroup}</span>
                  </div>
                </div>

                <div className="flex items-start">
                  <AlertTriangle className="h-5 w-5 mr-2 text-warning" />
                  <div>
                    <span className="font-medium">Allergies:</span>
                    {!isNegativeAllergy(allergies) ? (
                        <div className="flex items-center mt-1">
                          <Badge variant="destructive" className="mr-2">Allergy Alert</Badge>
                          <p>{allergies}</p>
                        </div>
                    ) : (
                        <p className="mt-1">{allergies}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="medical" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <Heart className="h-5 w-5 mr-2 text-primary" />
                  Medical Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2">Blood Group</h3>
                  <Badge variant={bloodGroup !== "Unknown" ? "default" : "outline"}>
                    {bloodGroup}
                  </Badge>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Allergies</h3>
                  {!isNegativeAllergy(allergies) ? (
                      <div className="flex items-center mt-1">
                        <Badge variant="destructive" className="mr-2">Allergy Alert</Badge>
                        <p>{allergies}</p>
                      </div>
                  ) : (
                      <p className="mt-1">{allergies}</p>
                  )}
                </div>

                {/* Placeholder for future medical information */}
                <div>
                  <h3 className="font-medium mb-2">Recent Diagnoses</h3>
                  <p className="text-sm text-muted-foreground">No recent diagnoses recorded</p>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Current Medications</h3>
                  <p className="text-sm text-muted-foreground">No current medications recorded</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="contact" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center">
                  <Phone className="h-5 w-5 mr-2" />
                  Contact Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2">Phone Number</h3>
                  <p className="flex items-center">
                    <Phone className="h-4 w-4 mr-2 text-muted-foreground" />
                    {contactInfo.phone}
                  </p>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Email Address</h3>
                  <p className="flex items-center">
                    <Mail className="h-4 w-4 mr-2 text-muted-foreground" />
                    {contactInfo.email}
                  </p>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Address</h3>
                  <p className="flex items-start">
                    <Home className="h-4 w-4 mr-2 text-muted-foreground mt-1" />
                    <span className="whitespace-pre-line">{address.formatted}</span>
                  </p>
                </div>

                <Separator />

                <div>
                  <h3 className="font-medium mb-2">Emergency Contact</h3>
                  {emergencyContact.name !== "Not provided" ? (
                    <div className="space-y-2">
                      <p className="flex items-center">
                        <User className="h-4 w-4 mr-2 text-muted-foreground" />
                        {emergencyContact.name} ({emergencyContact.relationship})
                      </p>
                      <p className="flex items-center">
                        <Phone className="h-4 w-4 mr-2 text-muted-foreground" />
                        {emergencyContact.phone}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No emergency contact provided</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default PatientDetail;
