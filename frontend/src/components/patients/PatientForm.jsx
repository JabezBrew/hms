import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { patientsApi } from "@/lib/api/patients";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Form validation schema
const patientFormSchema = z.object({
  // User fields
  email: z.string().email({ message: "Please enter a valid email address" }),
  password: z.string().min(8, { message: "Password must be at least 8 characters" }).optional(),
  confirm_password: z.string().optional(),
  first_name: z.string().min(1, { message: "First name is required" }),
  last_name: z.string().min(1, { message: "Last name is required" }),
  phone_number: z.string().optional(),
  date_of_birth: z.date({ required_error: "Date of birth is required" }),

  // PatientProfile fields
  medical_record_number: z.string().optional(), // Made optional as it will be generated on the backend
  nhis_id: z.string().optional(),
  blood_group: z.string().optional(),
  allergies: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z.string().optional(),
  emergency_contact_relationship: z.string().optional(),

  // Address fields
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
}).refine((data) => {
  // Only validate password match if password is provided (for updates)
  if (data.password || data.confirm_password) {
    return data.password === data.confirm_password;
  }
  return true;
}, {
  message: "Passwords do not match",
  path: ["confirm_password"],
});

const PatientForm = ({ patient, onSuccess }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [validationRules, setValidationRules] = useState([]);
  const isEditMode = !!patient;

  // Initialize form with default values or patient data
  const form = useForm({
    resolver: zodResolver(patientFormSchema),
    defaultValues: patient ? {
      // User fields
      email: patient.local_data?.user?.email || "",
      first_name: patient.local_data?.user?.first_name || "",
      last_name: patient.local_data?.user?.last_name || "",
      phone_number: patient.local_data?.user?.phone_number || "",
      date_of_birth: patient.local_data?.user?.date_of_birth ? new Date(patient.local_data.user.date_of_birth) : undefined,

      // PatientProfile fields
      medical_record_number: patient.local_data?.medical_record_number || "",
      nhis_id: patient.local_data?.nhis_id || "",
      blood_group: patient.local_data?.blood_group || "",
      allergies: patient.local_data?.allergies || "",
      emergency_contact_name: patient.local_data?.emergency_contact_name || "",
      emergency_contact_phone: patient.local_data?.emergency_contact_phone || "",
      emergency_contact_relationship: patient.local_data?.emergency_contact_relationship || "",

      // Address fields - extract from FHIR data if available
      address_line1: patient.fhir_data?.address?.[0]?.line?.[0] || "",
      address_line2: patient.fhir_data?.address?.[0]?.line?.[1] || "",
      city: patient.fhir_data?.address?.[0]?.city || "",
      state: patient.fhir_data?.address?.[0]?.state || "",
      postal_code: patient.fhir_data?.address?.[0]?.postalCode || "",
      country: patient.fhir_data?.address?.[0]?.country || "",
    } : {
      email: "",
      password: "",
      confirm_password: "",
      first_name: "",
      last_name: "",
      phone_number: "",
      date_of_birth: undefined,
      medical_record_number: "",
      nhis_id: "",
      blood_group: "",
      allergies: "",
      emergency_contact_name: "",
      emergency_contact_phone: "",
      emergency_contact_relationship: "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      postal_code: "",
      country: "",
    }
  });

  // Fetch validation rules on component mount
  useEffect(() => {
    const fetchValidationRules = async () => {
      try {
        const response = await patientsApi.getValidationRules();
        setValidationRules(response);
      } catch (error) {
        console.error('Failed to fetch validation rules:', error);
        toast.error("Failed to load validation rules");
      }
    };

    fetchValidationRules();
  }, []);

  const onSubmit = async (data) => {
    setIsLoading(true);
    try {
      let response;

      if (isEditMode) {
        // Prepare data for update
        const updateData = {
          local_data: {
            user: {
              email: data.email,
              first_name: data.first_name,
              last_name: data.last_name,
              phone_number: data.phone_number,
              date_of_birth: format(data.date_of_birth, 'yyyy-MM-dd'),
            },
            medical_record_number: data.medical_record_number,
            nhis_id: data.nhis_id,
            blood_group: data.blood_group,
            allergies: data.allergies,
            emergency_contact_name: data.emergency_contact_name,
            emergency_contact_phone: data.emergency_contact_phone,
            emergency_contact_relationship: data.emergency_contact_relationship,
          },
          fhir_data: {
            ...patient.fhir_data,
            name: [
              {
                family: data.last_name,
                given: [data.first_name],
              }
            ],
            telecom: [
              {
                system: "phone",
                value: data.phone_number,
                use: "home"
              }
            ],
            birthDate: format(data.date_of_birth, 'yyyy-MM-dd'),
            address: [
              {
                line: [
                  data.address_line1,
                  data.address_line2
                ].filter(Boolean),
                city: data.city,
                state: data.state,
                postalCode: data.postal_code,
                country: data.country
              }
            ]
          }
        };

        // Update patient
        response = await patientsApi.updatePatientWithFHIR(patient.local_data.id, updateData);
        toast.success("Patient updated successfully");
      } else {
        // Format data for registration
        const formattedData = {
          ...data,
          date_of_birth: format(data.date_of_birth, 'yyyy-MM-dd')
        };

        // Register new patient
        response = await patientsApi.registerPatient(formattedData);
        toast.success("Patient registered successfully");
      }

      if (onSuccess) {
        // Check if response.data exists, otherwise use response directly
        const patientData = response.data !== undefined ? response.data : response;

        // Log the response structure for debugging
        console.log('Patient creation/update response:', response);
        console.log('Patient data passed to onSuccess:', patientData);

        onSuccess(patientData);
      }
    } catch (error) {
      console.error('Failed to save patient:', error);
      toast.error(error.response?.data?.error || "Failed to save patient");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{isEditMode ? "Edit Patient" : "Register New Patient"}</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="personal">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="personal">Personal Information</TabsTrigger>
            <TabsTrigger value="medical">Medical Information</TabsTrigger>
            <TabsTrigger value="contact">Contact Information</TabsTrigger>
          </TabsList>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <TabsContent value="personal" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="first_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input placeholder="First name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="last_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Last name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="date_of_birth"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Date of Birth</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? (
                                format(field.value, "PPP")
                              ) : (
                                <span>Pick a date</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            disabled={(date) =>
                              date > new Date() || date < new Date("1900-01-01")
                            }
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="Email address" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!isEditMode && (
                  <>
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="Password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="confirm_password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirm Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="Confirm password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
              </TabsContent>

              <TabsContent value="medical" className="space-y-4 mt-4">
                {isEditMode && (
                  <FormField
                    control={form.control}
                    name="medical_record_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Medical Record Number</FormLabel>
                        <FormControl>
                          <Input placeholder="Medical record number" {...field} readOnly />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="nhis_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>NHIS ID</FormLabel>
                      <FormControl>
                        <Input placeholder="NHIS ID" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="blood_group"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Blood Group</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select blood group" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="A+">A+</SelectItem>
                          <SelectItem value="A-">A-</SelectItem>
                          <SelectItem value="B+">B+</SelectItem>
                          <SelectItem value="B-">B-</SelectItem>
                          <SelectItem value="AB+">AB+</SelectItem>
                          <SelectItem value="AB-">AB-</SelectItem>
                          <SelectItem value="O+">O+</SelectItem>
                          <SelectItem value="O-">O-</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="allergies"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Allergies</FormLabel>
                      <FormControl>
                        <Textarea placeholder="List any allergies" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="contact" className="space-y-4 mt-4">
                <FormField
                  control={form.control}
                  name="phone_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl>
                        <Input placeholder="Phone number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator className="my-4" />
                <h3 className="text-lg font-medium">Address</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="address_line1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address Line 1</FormLabel>
                        <FormControl>
                          <Input placeholder="Address line 1" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="address_line2"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address Line 2</FormLabel>
                        <FormControl>
                          <Input placeholder="Address line 2" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input placeholder="City" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State/Province</FormLabel>
                        <FormControl>
                          <Input placeholder="State/Province" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="postal_code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Postal Code</FormLabel>
                        <FormControl>
                          <Input placeholder="Postal code" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country</FormLabel>
                        <FormControl>
                          <Input placeholder="Country" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator className="my-4" />
                <h3 className="text-lg font-medium">Emergency Contact</h3>

                <FormField
                  control={form.control}
                  name="emergency_contact_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Emergency Contact Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Emergency contact name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="emergency_contact_phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Emergency Contact Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="Emergency contact phone" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="emergency_contact_relationship"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Relationship</FormLabel>
                      <FormControl>
                        <Input placeholder="Relationship to patient" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? "Saving..." : isEditMode ? "Update Patient" : "Register Patient"}
                </Button>
              </div>
            </form>
          </Form>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default PatientForm;
