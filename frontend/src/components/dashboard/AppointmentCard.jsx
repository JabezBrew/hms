import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Clock, Video } from "lucide-react"

export function AppointmentCard({ appointment, onClick }) {
    const {
        patientName,
        patientImage,
        time,
        chiefComplaint,
        status,
        type
    } = appointment

    const getStatusColor = (status) => {
        switch (status) {
            case 'checked-in':
            case 'in-room':
                return 'border-l-green-500'
            case 'telehealth-active':
                return 'border-l-blue-500'
            default:
                return 'border-l-gray-300'
        }
    }

    const getStatusBadge = (status) => {
        switch (status) {
            case 'checked-in':
                return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Checked In</Badge>
            case 'in-room':
                return <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">In Room</Badge>
            case 'telehealth-active':
                return (
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 animate-pulse">
                        <Video className="w-3 h-3 mr-1" /> Active Call
                    </Badge>
                )
            default:
                return <Badge variant="outline" className="text-muted-foreground">Upcoming</Badge>
        }
    }

    return (
        <Card
            className={cn(
                "mb-3 hover:shadow-md transition-shadow cursor-pointer border-l-4",
                getStatusColor(status)
            )}
            onClick={onClick}
        >
            <CardContent className="p-4 flex items-center gap-4">
                <div className="flex flex-col items-center min-w-[60px]">
                    <span className="text-lg font-bold text-foreground">{time}</span>
                    <span className="text-xs text-muted-foreground uppercase">{type}</span>
                </div>

                <Avatar className="h-12 w-12 border-2 border-background">
                    <AvatarImage src={patientImage} alt={patientName} />
                    <AvatarFallback>{patientName.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                        <h3 className="font-semibold text-base truncate">{patientName}</h3>
                        {getStatusBadge(status)}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                        {chiefComplaint}
                    </p>
                </div>
            </CardContent>
        </Card>
    )
}
