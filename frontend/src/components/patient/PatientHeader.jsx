import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import differenceInYears from "date-fns/differenceInYears";
import parseISO from "date-fns/parseISO";

export function PatientHeader({ patient, onAction }) {
    if (!patient) return null

    // Extract patient data from nested structure
    const userDetails = patient.local_data?.user_details || {};
    const firstName = userDetails.first_name || 'Unknown';
    const lastName = userDetails.last_name || '';
    const dateOfBirth = userDetails.date_of_birth;
    const gender = userDetails.gender;
    const mrn = patient.local_data?.medical_record_number || patient.local_data?.id || 'N/A';

    const age = dateOfBirth
        ? differenceInYears(new Date(), parseISO(dateOfBirth))
        : 'Unknown'

    return (
        <div className="sticky top-16 z-40 w-full bg-background border-b shadow-sm">
            {/* Safety Banner */}
            <div className="flex items-center gap-4 px-6 py-1 text-xs font-semibold text-white">
                <div className="flex items-center gap-2 bg-red-600 px-3 py-1 rounded-full">
                    <AlertTriangle className="size-3" />
                    <span>Allergies: Penicillin, Latex</span>
                </div>
                <div className="flex items-center gap-2 bg-purple-600 px-3 py-1 rounded-full">
                    <ShieldAlert className="size-3" />
                    <span>Code Status: DNR</span>
                </div>
                <div className="flex items-center gap-2 bg-yellow-600 px-3 py-1 rounded-full">
                    <Activity className="size-3" />
                    <span>Fall Risk</span>
                </div>
            </div>

            {/* Identity & Actions */}
            <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-4">
                    <Avatar className="size-16 border-2 border-muted">
                        <AvatarImage src={patient.image} alt={firstName} />
                        <AvatarFallback className="text-lg">
                            {firstName?.[0]}{lastName?.[0]}
                        </AvatarFallback>
                    </Avatar>

                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold tracking-tight">
                                {firstName} {lastName}
                            </h1>
                            <Badge variant="outline" className="text-base font-normal">
                                {age} yo {gender === 'M' ? 'M' : gender === 'F' ? 'F' : 'U'}
                            </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                            <span>DOB: {dateOfBirth || 'N/A'}</span>
                            <span>•</span>
                            <span>MRN: {mrn}</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Button onClick={() => onAction('note')}>
                        <FileText className="mr-2 size-4" />
                        New Note
                    </Button>
                    <Button variant="outline" onClick={() => onAction('prescribe')}>
                        <Pill className="mr-2 size-4" />
                        ePrescribe
                    </Button>
                    <Button variant="outline" onClick={() => onAction('message')}>
                        <MessageSquare className="mr-2 size-4" />
                        Message
                    </Button>
                </div>
            </div>
        </div>
    )
}
