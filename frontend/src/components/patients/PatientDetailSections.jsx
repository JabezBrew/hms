import User from 'lucide-react/dist/esm/icons/user.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Heart from 'lucide-react/dist/esm/icons/heart.js';
import Droplet from 'lucide-react/dist/esm/icons/droplet.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import Image from 'lucide-react/dist/esm/icons/image.js';
import FileImage from 'lucide-react/dist/esm/icons/file-image.js';
import Receipt from 'lucide-react/dist/esm/icons/receipt.js';
import CreditCard from 'lucide-react/dist/esm/icons/credit-card.js';
import History from 'lucide-react/dist/esm/icons/history.js';
import BarChart from 'lucide-react/dist/esm/icons/chart-no-axes-column-increasing.js';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
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

function isNegativeAllergy(allergyText) {
  if (!allergyText) return true;

  const text = allergyText.toLowerCase().trim();
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

  return negativeResponses.some(response =>
    text === response || text.includes(response)
  );
}

function AllergySummary({ allergies }) {
  return !isNegativeAllergy(allergies) ? (
    <div className="flex items-center mt-1">
      <Badge variant="destructive" className="mr-2">Allergy Alert</Badge>
      <p>{allergies}</p>
    </div>
  ) : (
    <p className="mt-1">{allergies}</p>
  );
}

export function PatientDetailEmptyState({ onBack }) {
  return (
    <Card className="w-full">
      <CardContent className="pt-6 text-center">
        <p className="text-muted-foreground">No patient selected</p>
        <Button variant="outline" className="mt-4" onClick={onBack}>
          <ArrowLeft className="mr-2 size-4" />
          Back to Patient List
        </Button>
      </CardContent>
    </Card>
  );
}

function PatientDetailHeader({
  info,
  isDeleting,
  onBack,
  onDeletePatient,
  onEdit,
  patientDeletionAvailable,
}) {
  return (
    <CardHeader className="flex flex-row items-start justify-between">
      <div>
        <div className="flex flex-col">
          <Button variant="outline" size="sm" className="mb-2 w-fit" onClick={onBack}>
            <ArrowLeft className="mr-2 size-4" />
            Back
          </Button>
          <div className="flex items-center pl-0">
            <Avatar className="size-12 mr-4">
              <AvatarFallback>{info.initials}</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle className="text-2xl">{info.displayName}</CardTitle>
              <CardDescription className="flex items-center mt-1">
                <FileText className="size-4 mr-1" />
                MRN: {info.mrn}
                {info.nhisId !== "Not provided" && (
                  <Badge variant="outline" className="ml-2">
                    NHIS: {info.nhisId}
                  </Badge>
                )}
              </CardDescription>
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-x-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Edit className="size-4 mr-2" />
          Edit
        </Button>
        {patientDeletionAvailable ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="size-4 mr-2" />
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
                  onClick={onDeletePatient}
                  disabled={isDeleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <p className="max-w-56 text-right text-xs text-muted-foreground">
            Patient deletion is not available in Rust V2 mode.
          </p>
        )}
      </div>
    </CardHeader>
  );
}

function PatientOverviewTab({ info }) {
  return (
    <TabsContent value="overview" className="space-y-4 mt-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center">
              <User className="size-5 mr-2" />
              Personal Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Full Name:</span>
              <span className="font-medium">{info.displayName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date of Birth:</span>
              <span className="font-medium">{info.dob}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Age:</span>
              <span className="font-medium">{info.age}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">MRN:</span>
              <span className="font-medium">{info.mrn}</span>
            </div>
            {info.nhisId !== "Not provided" && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">NHIS ID:</span>
                <span className="font-medium">{info.nhisId}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center">
              <Phone className="size-5 mr-2" />
              Contact Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Phone:</span>
              <span className="font-medium">{info.contactInfo.phone}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email:</span>
              <span className="font-medium">{info.contactInfo.email}</span>
            </div>
            <Separator className="my-2" />
            <div>
              <span className="text-muted-foreground">Address:</span>
              <p className="font-medium whitespace-pre-line mt-1">{info.address.formatted}</p>
            </div>
            <Separator className="my-2" />
            <div>
              <span className="text-muted-foreground">Emergency Contact:</span>
              {info.emergencyContact.name !== "Not provided" ? (
                <div className="space-y-2 mt-1">
                  <p className="flex items-center">
                    <User className="size-4 mr-2 text-muted-foreground" />
                    {info.emergencyContact.name} ({info.emergencyContact.relationship})
                  </p>
                  <p className="flex items-center">
                    <Phone className="size-4 mr-2 text-muted-foreground" />
                    {info.emergencyContact.phone}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">No emergency contact provided</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center">
            <Activity className="size-5 mr-2" />
            Medical Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-start">
            <Droplet className="size-5 mr-2 text-primary" />
            <div>
              <span className="font-medium">Blood Group:</span>
              <span className="ml-2">{info.bloodGroup}</span>
            </div>
          </div>

          <div className="flex items-start">
            <AlertTriangle className="size-5 mr-2 text-warning" />
            <div>
              <span className="font-medium">Allergies:</span>
              <AllergySummary allergies={info.allergies} />
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

function PatientMedicalTab({ info }) {
  return (
    <TabsContent value="medical" className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center">
            <Heart className="size-5 mr-2 text-primary" />
            Medical Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-medium mb-2">Blood Group</h3>
            <Badge variant={info.bloodGroup !== "Unknown" ? "default" : "outline"}>
              {info.bloodGroup}
            </Badge>
          </div>

          <div>
            <h3 className="font-medium mb-2">Allergies</h3>
            <AllergySummary allergies={info.allergies} />
          </div>

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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center">
            <Stethoscope className="size-5 mr-2 text-primary" />
            Vitals & Lab Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Latest Vitals</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Blood Pressure:</span>
                  <Badge variant="outline">120/80 mmHg</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Temperature:</span>
                  <Badge variant="outline">36.5 °C</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Heart Rate:</span>
                  <Badge variant="outline">72 bpm</Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Key Labs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Hemoglobin:</span>
                  <Badge variant="outline">14.2 g/dL</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">WBC:</span>
                  <Badge variant="outline">7.5 x10³/μL</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Glucose:</span>
                  <Badge variant="outline">95 mg/dL</Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Last Updated</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Vitals:</span>
                  <span className="text-sm">2 days ago</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Labs:</span>
                  <span className="text-sm">1 week ago</span>
                </div>
                <div className="flex items-center justify-center mt-2">
                  <Button variant="outline" size="sm" className="w-full">
                    <BarChart className="size-4 mr-2" />
                    View All Results
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

function PatientEncountersTab() {
  return (
    <TabsContent value="encounters" className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center">
            <Clock className="size-5 mr-2 text-primary" />
            Visit History
          </CardTitle>
          <CardDescription>
            Recent patient encounters and visits
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>May 15, 2023</TableCell>
                <TableCell>
                  <Badge variant="outline">OPD</Badge>
                </TableCell>
                <TableCell>Cardiology</TableCell>
                <TableCell>Dr. Sarah Johnson</TableCell>
                <TableCell>
                  <Badge variant="success">Discharged</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">View</Button>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Apr 3, 2023</TableCell>
                <TableCell>
                  <Badge variant="outline">Emergency</Badge>
                </TableCell>
                <TableCell>Emergency Medicine</TableCell>
                <TableCell>Dr. Michael Chen</TableCell>
                <TableCell>
                  <Badge variant="warning">Admitted</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">View</Button>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Mar 22, 2023</TableCell>
                <TableCell>
                  <Badge variant="outline">IPD</Badge>
                </TableCell>
                <TableCell>General Surgery</TableCell>
                <TableCell>Dr. Robert Williams</TableCell>
                <TableCell>
                  <Badge variant="success">Discharged</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">View</Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <div className="flex justify-center mt-4">
            <Button variant="outline">
              View Full Encounter History
            </Button>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

function PatientInpatientTab() {
  return (
    <TabsContent value="inpatient" className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center">
            <Building2 className="size-5 mr-2 text-primary" />
            Inpatient Status
          </CardTitle>
          <CardDescription>
            Current and past admissions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="border rounded-lg p-4 bg-muted/20">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <Badge variant="secondary" className="mr-2">Current Admission</Badge>
                <span className="text-sm text-muted-foreground">Admitted: May 3, 2023</span>
              </div>
              <Badge variant="outline">5 days</Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <h3 className="text-sm font-medium mb-1">Ward</h3>
                <div className="flex items-center">
                  <Building2 className="size-4 mr-2 text-muted-foreground" />
                  <span>Medical Ward - East Wing</span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">Bed</h3>
                <div className="flex items-center">
                  <Bed className="size-4 mr-2 text-muted-foreground" />
                  <span>Room 304, Bed B</span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-1">Attending Physician</h3>
                <div className="flex items-center">
                  <User className="size-4 mr-2 text-muted-foreground" />
                  <span>Dr. Michael Chen</span>
                </div>
              </div>
            </div>

            <Separator className="my-4" />

            <div>
              <h3 className="text-sm font-medium mb-2">Daily Billing Summary</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Room Charge</TableHead>
                    <TableHead>Medication</TableHead>
                    <TableHead>Services</TableHead>
                    <TableHead className="text-right">Daily Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>May 7, 2023</TableCell>
                    <TableCell>$250.00</TableCell>
                    <TableCell>$75.50</TableCell>
                    <TableCell>$120.00</TableCell>
                    <TableCell className="text-right font-medium">$445.50</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>May 6, 2023</TableCell>
                    <TableCell>$250.00</TableCell>
                    <TableCell>$85.25</TableCell>
                    <TableCell>$95.00</TableCell>
                    <TableCell className="text-right font-medium">$430.25</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>May 5, 2023</TableCell>
                    <TableCell>$250.00</TableCell>
                    <TableCell>$92.75</TableCell>
                    <TableCell>$150.00</TableCell>
                    <TableCell className="text-right font-medium">$492.75</TableCell>
                  </TableRow>
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4}>Total Charges</TableCell>
                    <TableCell className="text-right">$1,368.50</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-md">Past Admissions</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Admission Date</TableHead>
                    <TableHead>Discharge Date</TableHead>
                    <TableHead>Ward</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Length of Stay</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Mar 22, 2023</TableCell>
                    <TableCell>Mar 25, 2023</TableCell>
                    <TableCell>Surgical Ward</TableCell>
                    <TableCell>Appendectomy</TableCell>
                    <TableCell>3 days</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">Details</Button>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Jan 15, 2023</TableCell>
                    <TableCell>Jan 18, 2023</TableCell>
                    <TableCell>Medical Ward</TableCell>
                    <TableCell>Pneumonia</TableCell>
                    <TableCell>3 days</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">Details</Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

function PatientImagingTab() {
  return (
    <TabsContent value="imaging" className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center">
            <FileImage className="size-5 mr-2 text-primary" />
            Imaging & Reports
          </CardTitle>
          <CardDescription>
            Radiology images and diagnostic reports
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="overflow-hidden">
              <div className="relative aspect-square bg-muted">
                <div className="absolute inset-0 flex items-center justify-center">
                  <Image className="size-12 text-muted-foreground" />
                </div>
              </div>
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium">Chest X-ray</h3>
                    <p className="text-xs text-muted-foreground">May 4, 2023</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-8">
                    <Image className="size-4 mr-2" />
                    View
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <div className="relative aspect-square bg-muted">
                <div className="absolute inset-0 flex items-center justify-center">
                  <Image className="size-12 text-muted-foreground" />
                </div>
              </div>
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium">CT Head</h3>
                    <p className="text-xs text-muted-foreground">Apr 15, 2023</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-8">
                    <Image className="size-4 mr-2" />
                    View
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <div className="relative aspect-square bg-muted">
                <div className="absolute inset-0 flex items-center justify-center">
                  <Activity className="size-12 text-muted-foreground" />
                </div>
              </div>
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium">ECG</h3>
                    <p className="text-xs text-muted-foreground">Mar 22, 2023</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-8">
                    <Activity className="size-4 mr-2" />
                    View
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Separator className="my-6" />

          <div>
            <h3 className="text-lg font-medium mb-4">Diagnostic Reports</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Ordered By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>May 4, 2023</TableCell>
                  <TableCell>Chest X-ray Report</TableCell>
                  <TableCell>Dr. Sarah Johnson</TableCell>
                  <TableCell>
                    <Badge variant="success">Completed</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      <FileText className="size-4 mr-2" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Apr 15, 2023</TableCell>
                  <TableCell>CT Head Report</TableCell>
                  <TableCell>Dr. Michael Chen</TableCell>
                  <TableCell>
                    <Badge variant="success">Completed</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      <FileText className="size-4 mr-2" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Mar 22, 2023</TableCell>
                  <TableCell>ECG Report</TableCell>
                  <TableCell>Dr. Robert Williams</TableCell>
                  <TableCell>
                    <Badge variant="success">Completed</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      <FileText className="size-4 mr-2" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>May 6, 2023</TableCell>
                  <TableCell>Blood Culture</TableCell>
                  <TableCell>Dr. Michael Chen</TableCell>
                  <TableCell>
                    <Badge variant="warning">Pending</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" disabled>
                      <Clock className="size-4 mr-2" />
                      Awaiting
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

function PatientBillingTab() {
  return (
    <TabsContent value="billing" className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center">
            <Receipt className="size-5 mr-2 text-primary" />
            Billing & Payments
          </CardTitle>
          <CardDescription>
            Invoice history and payment information
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between p-4 border rounded-lg bg-muted/20">
            <div>
              <h3 className="text-lg font-medium">Outstanding Balance</h3>
              <p className="text-3xl font-bold text-primary mt-1">$2,145.75</p>
              <p className="text-sm text-muted-foreground mt-1">Last updated: May 7, 2023</p>
            </div>
            <div className="flex flex-col gap-2">
              <Button className="w-full md:w-auto">
                <CreditCard className="size-4 mr-2" />
                Pay Now
              </Button>
              <Button variant="outline" className="w-full md:w-auto">
                <FileText className="size-4 mr-2" />
                Download Statement
              </Button>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium mb-4">Recent Invoices</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>INV-2023-0542</TableCell>
                  <TableCell>May 7, 2023</TableCell>
                  <TableCell>Inpatient Care</TableCell>
                  <TableCell>$445.50</TableCell>
                  <TableCell>
                    <Badge variant="destructive">Unpaid</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      <Receipt className="size-4 mr-2" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>INV-2023-0541</TableCell>
                  <TableCell>May 6, 2023</TableCell>
                  <TableCell>Inpatient Care</TableCell>
                  <TableCell>$430.25</TableCell>
                  <TableCell>
                    <Badge variant="destructive">Unpaid</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      <Receipt className="size-4 mr-2" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>INV-2023-0540</TableCell>
                  <TableCell>May 5, 2023</TableCell>
                  <TableCell>Inpatient Care</TableCell>
                  <TableCell>$492.75</TableCell>
                  <TableCell>
                    <Badge variant="destructive">Unpaid</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      <Receipt className="size-4 mr-2" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>INV-2023-0498</TableCell>
                  <TableCell>Apr 15, 2023</TableCell>
                  <TableCell>CT Scan</TableCell>
                  <TableCell>$850.00</TableCell>
                  <TableCell>
                    <Badge variant="outline">Paid</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      <Receipt className="size-4 mr-2" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>INV-2023-0432</TableCell>
                  <TableCell>Mar 22, 2023</TableCell>
                  <TableCell>Surgery - Appendectomy</TableCell>
                  <TableCell>$4,250.00</TableCell>
                  <TableCell>
                    <Badge variant="outline">Paid</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      <Receipt className="size-4 mr-2" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div>
            <h3 className="text-lg font-medium mb-4">Payment Methods</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-md flex items-center">
                    <CreditCard className="size-4 mr-2" />
                    Credit Card
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">Visa ending in 4242</p>
                  <p className="text-sm text-muted-foreground">Expires 05/25</p>
                  <div className="flex gap-2 mt-2">
                    <Button variant="outline" size="sm">Edit</Button>
                    <Button variant="ghost" size="sm">Remove</Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-md flex items-center">
                    <CreditCard className="size-4 mr-2" />
                    Add Payment Method
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full">
                    <CreditCard className="size-4 mr-2" />
                    Add New Card
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

function PatientTimelineTab() {
  return (
    <TabsContent value="timeline" className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center">
            <History className="size-5 mr-2 text-primary" />
            Activity Timeline
          </CardTitle>
          <CardDescription>
            Chronological history of patient activities
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative pl-6 border-l">
            <div className="mb-8">
              <h3 className="text-md font-medium mb-4 -ml-6">Today</h3>

              <div className="relative mb-6">
                <div className="absolute -left-[29px] p-1 rounded-full bg-primary">
                  <Stethoscope className="size-4 text-primary-foreground" />
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium">Vitals Recorded</h4>
                      <p className="text-sm text-muted-foreground">BP: 120/80, Temp: 36.5°C, HR: 72 bpm</p>
                    </div>
                    <Badge variant="outline">10:30 AM</Badge>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Button variant="ghost" size="sm">
                      <FileText className="size-4 mr-2" />
                      View Details
                    </Button>
                  </div>
                </div>
              </div>

              <div className="relative mb-6">
                <div className="absolute -left-[29px] p-1 rounded-full bg-primary">
                  <User className="size-4 text-primary-foreground" />
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium">Doctor Visit</h4>
                      <p className="text-sm text-muted-foreground">Dr. Michael Chen - Daily Rounds</p>
                    </div>
                    <Badge variant="outline">9:15 AM</Badge>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Button variant="ghost" size="sm">
                      <FileText className="size-4 mr-2" />
                      View Notes
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-8">
              <h3 className="text-md font-medium mb-4 -ml-6">Yesterday</h3>

              <div className="relative mb-6">
                <div className="absolute -left-[29px] p-1 rounded-full bg-warning">
                  <Activity className="size-4 text-warning-foreground" />
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium">Lab Results</h4>
                      <p className="text-sm text-muted-foreground">Blood Culture - Pending</p>
                    </div>
                    <Badge variant="outline">4:45 PM</Badge>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Button variant="ghost" size="sm" disabled>
                      <Clock className="size-4 mr-2" />
                      Awaiting Results
                    </Button>
                  </div>
                </div>
              </div>

              <div className="relative mb-6">
                <div className="absolute -left-[29px] p-1 rounded-full bg-destructive">
                  <Receipt className="size-4 text-destructive-foreground" />
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium">Invoice Generated</h4>
                      <p className="text-sm text-muted-foreground">INV-2023-0542 - $445.50</p>
                    </div>
                    <Badge variant="outline">2:30 PM</Badge>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Button variant="ghost" size="sm">
                      <Receipt className="size-4 mr-2" />
                      View Invoice
                    </Button>
                    <Button variant="ghost" size="sm">
                      <CreditCard className="size-4 mr-2" />
                      Pay Now
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-md font-medium mb-4 -ml-6">Earlier This Week</h3>

              <div className="relative mb-6">
                <div className="absolute -left-[29px] p-1 rounded-full bg-primary">
                  <FileImage className="size-4 text-primary-foreground" />
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium">Chest X-ray Completed</h4>
                      <p className="text-sm text-muted-foreground">Radiology Department</p>
                    </div>
                    <Badge variant="outline">May 4, 2023</Badge>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Button variant="ghost" size="sm">
                      <Image className="size-4 mr-2" />
                      View Image
                    </Button>
                    <Button variant="ghost" size="sm">
                      <FileText className="size-4 mr-2" />
                      View Report
                    </Button>
                  </div>
                </div>
              </div>

              <div className="relative mb-6">
                <div className="absolute -left-[29px] p-1 rounded-full bg-secondary">
                  <Building2 className="size-4 text-secondary-foreground" />
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium">Admitted to Hospital</h4>
                      <p className="text-sm text-muted-foreground">Medical Ward - East Wing, Room 304, Bed B</p>
                    </div>
                    <Badge variant="outline">May 3, 2023</Badge>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Button variant="ghost" size="sm">
                      <FileText className="size-4 mr-2" />
                      View Admission Details
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-center mt-6">
              <Button variant="outline">
                <History className="size-4 mr-2" />
                View Complete History
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

function PatientDetailTabs({ info }) {
  return (
    <Tabs defaultValue="overview">
      <TabsList className="grid w-full grid-cols-7">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="medical">Medical Information</TabsTrigger>
        <TabsTrigger value="encounters">Encounters</TabsTrigger>
        <TabsTrigger value="inpatient">Inpatient</TabsTrigger>
        <TabsTrigger value="imaging">Imaging</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
      </TabsList>

      <PatientOverviewTab info={info} />
      <PatientMedicalTab info={info} />
      <PatientEncountersTab />
      <PatientInpatientTab />
      <PatientImagingTab />
      <PatientBillingTab />
      <PatientTimelineTab />
    </Tabs>
  );
}

export function PatientDetailLayout({
  info,
  isDeleting,
  onBack,
  onDeletePatient,
  onEdit,
  patientDeletionAvailable,
}) {
  return (
    <Card className="w-full">
      <PatientDetailHeader
        info={info}
        isDeleting={isDeleting}
        onBack={onBack}
        onDeletePatient={onDeletePatient}
        onEdit={onEdit}
        patientDeletionAvailable={patientDeletionAvailable}
      />
      <CardContent>
        <PatientDetailTabs info={info} />
      </CardContent>
    </Card>
  );
}
