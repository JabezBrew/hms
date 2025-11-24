import { AppointmentCard } from "@/components/dashboard/AppointmentCard"
import { Inbox } from "@/components/dashboard/Inbox"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { useNavigate } from "react-router-dom"

// Mock Data
const mockAppointments = [
    {
        id: '1',
        patientName: 'Sarah Johnson',
        patientImage: '',
        time: '09:00',
        type: 'Follow-up',
        chiefComplaint: 'Hypertension follow-up, reports dizziness',
        status: 'in-room'
    },
    {
        id: '2',
        patientName: 'Michael Chen',
        patientImage: '',
        time: '09:30',
        type: 'New Visit',
        chiefComplaint: 'Right knee pain after hiking',
        status: 'checked-in'
    },
    {
        id: '3',
        patientName: 'Emma Davis',
        patientImage: '',
        time: '10:00',
        type: 'Telehealth',
        chiefComplaint: 'Anxiety medication review',
        status: 'telehealth-active'
    },
    {
        id: '4',
        patientName: 'James Wilson',
        patientImage: '',
        time: '10:30',
        type: 'Annual',
        chiefComplaint: 'Annual physical exam',
        status: 'upcoming'
    },
    {
        id: '5',
        patientName: 'Linda Martinez',
        patientImage: '',
        time: '11:00',
        type: 'Follow-up',
        chiefComplaint: 'Diabetes management',
        status: 'upcoming'
    }
]

const mockTasks = [
    {
        id: 't1',
        type: 'Refill',
        priority: 'Routine',
        patientName: 'Robert Taylor',
        details: 'Lisinopril 10mg - 90 day supply',
        status: 'Pending'
    },
    {
        id: 't2',
        type: 'LabReview',
        priority: 'Urgent',
        patientName: 'Sarah Johnson',
        details: 'Elevated Potassium (5.8)',
        status: 'Pending'
    },
    {
        id: 't3',
        type: 'SignNote',
        priority: 'Routine',
        patientName: 'Michael Chen',
        details: 'Office Visit - Knee Pain',
        status: 'Pending'
    },
    {
        id: 't4',
        type: 'Refill',
        priority: 'Routine',
        patientName: 'Emily White',
        details: 'Metformin 500mg',
        status: 'Pending'
    }
]

export default function ProviderDashboard() {
    const navigate = useNavigate()

    return (
        <div className="p-6 h-[calc(100vh-3.5rem)] flex flex-col gap-6">
            <div className="flex items-center justify-between shrink-0">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Good Morning, Dr. Smith</h1>
                    <p className="text-muted-foreground">You have 5 appointments and 4 tasks pending today.</p>
                </div>
                <div className="flex gap-3">
                    <Button onClick={() => navigate('/appointments/create')}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Appointment
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
                {/* Column 1: Up Next Stream (60% -> 7 cols) */}
                <div className="lg:col-span-7 flex flex-col min-h-0">
                    <div className="flex items-center justify-between mb-4 shrink-0">
                        <h2 className="font-semibold text-lg">Up Next</h2>
                        <span className="text-sm text-muted-foreground">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-2 space-y-1">
                        {mockAppointments.map(apt => (
                            <AppointmentCard
                                key={apt.id}
                                appointment={apt}
                                onClick={() => navigate(`/encounters/${apt.id}`)}
                            />
                        ))}

                        <div className="py-4 text-center">
                            <p className="text-sm text-muted-foreground">End of scheduled appointments</p>
                        </div>
                    </div>
                </div>

                {/* Column 2: Rapid Task Inbox (40% -> 5 cols) */}
                <div className="lg:col-span-5 flex flex-col min-h-0">
                    <Inbox tasks={mockTasks} />
                </div>
            </div>
        </div>
    )
}
