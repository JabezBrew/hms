import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, FileText, FlaskConical, Pill, Calendar } from "lucide-react"

export function TimelineFeed({ items }) {
    const getIcon = (type) => {
        switch (type) {
            case 'Encounter': return <Calendar className="h-4 w-4 text-blue-500" />
            case 'LabResult': return <FlaskConical className="h-4 w-4 text-purple-500" />
            case 'Document': return <FileText className="h-4 w-4 text-orange-500" />
            case 'Medication': return <Pill className="h-4 w-4 text-green-500" />
            default: return <FileText className="h-4 w-4" />
        }
    }

    return (
        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search this chart..." className="pl-8" />
            </div>

            <div className="space-y-4">
                {items.map((item) => (
                    <Card key={item.id} className="hover:bg-accent/5 transition-colors">
                        <CardContent className="p-4">
                            <div className="flex gap-4">
                                <div className="flex flex-col items-center gap-1 min-w-[60px]">
                                    <div className="p-2 rounded-full bg-muted">
                                        {getIcon(item.type)}
                                    </div>
                                    <div className="h-full w-px bg-border my-2" />
                                </div>

                                <div className="flex-1 space-y-1">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-semibold">{item.title}</h3>
                                        <span className="text-xs text-muted-foreground">{item.date}</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground line-clamp-2">
                                        {item.summary}
                                    </p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <Badge variant="secondary" className="text-xs font-normal">
                                            {item.author}
                                        </Badge>
                                        <Badge variant="outline" className="text-xs font-normal">
                                            {item.type}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}
