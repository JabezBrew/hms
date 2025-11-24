import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"

const SYSTEMS = [
    "Constitutional",
    "Eyes",
    "ENT",
    "Cardiovascular",
    "Respiratory",
    "Gastrointestinal",
    "Genitourinary",
    "Musculoskeletal",
    "Skin",
    "Neurological",
    "Psychiatric",
    "Endocrine",
    "Hematologic/Lymphatic",
    "Allergic/Immunologic"
]

export function ReviewOfSystems() {
    // State: 'normal' | 'abnormal' | null (not asked)
    const [status, setStatus] = useState({})

    const toggleStatus = (system, newStatus) => {
        setStatus(prev => ({
            ...prev,
            [system]: prev[system] === newStatus ? null : newStatus
        }))
    }

    const markAllNormal = () => {
        const newStatus = {}
        SYSTEMS.forEach(s => newStatus[s] = 'normal')
        setStatus(newStatus)
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Review of Systems</h3>
                <Button variant="ghost" size="sm" onClick={markAllNormal} className="text-xs">
                    Mark All Normal
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {SYSTEMS.map(system => (
                    <div key={system} className="flex items-center justify-between p-2 rounded-md border bg-card hover:bg-accent/50 transition-colors">
                        <span className="text-sm font-medium">{system}</span>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                    "h-6 w-6 rounded-full",
                                    status[system] === 'normal' && "bg-green-100 text-green-700 hover:bg-green-200 hover:text-green-800"
                                )}
                                onClick={() => toggleStatus(system, 'normal')}
                            >
                                <Check className="h-3 w-3" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                    "h-6 w-6 rounded-full",
                                    status[system] === 'abnormal' && "bg-red-100 text-red-700 hover:bg-red-200 hover:text-red-800"
                                )}
                                onClick={() => toggleStatus(system, 'abnormal')}
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
