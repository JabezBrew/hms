import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { FileText, Pill, FlaskConical, ChevronRight, CheckCircle2, Clock } from "lucide-react"
import { SlideOver } from "@/components/ui/SlideOver"

export function Inbox({ tasks }) {
    const [selectedTask, setSelectedTask] = useState(null)

    const getTaskIcon = (type) => {
        switch (type) {
            case 'Refill': return <Pill className="h-4 w-4 text-blue-500" />
            case 'LabReview': return <FlaskConical className="h-4 w-4 text-purple-500" />
            case 'SignNote': return <FileText className="h-4 w-4 text-orange-500" />
            default: return <FileText className="h-4 w-4" />
        }
    }

    const getPriorityColor = (priority) => {
        return priority === 'Urgent' ? 'text-red-600 bg-red-50 border-red-200' : 'text-gray-600 bg-gray-50 border-gray-200'
    }

    const TaskList = ({ filter }) => {
        const filteredTasks = filter === 'All' ? tasks : tasks.filter(t => t.type === filter)

        if (filteredTasks.length === 0) {
            return <div className="p-8 text-center text-muted-foreground">No tasks found.</div>
        }

        return (
            <div className="space-y-2">
                {filteredTasks.map(task => (
                    <div
                        key={task.id}
                        className="group flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
                        onClick={() => setSelectedTask(task)}
                    >
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-full bg-background border shadow-sm">
                                {getTaskIcon(task.type)}
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm">{task.patientName}</span>
                                    <Badge variant="outline" className={getPriorityColor(task.priority)}>
                                        {task.priority}
                                    </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">{task.details}</p>
                            </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                ))}
            </div>
        )
    }

    return (
        <>
            <Card className="h-full flex flex-col">
                <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg font-semibold flex items-center gap-2">
                            Inbox
                            <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-xs">
                                {tasks.length}
                            </Badge>
                        </CardTitle>
                    </div>
                </CardHeader>
                <CardContent className="flex-1 p-0">
                    <Tabs defaultValue="All" className="h-full flex flex-col">
                        <div className="px-6 pb-2">
                            <TabsList className="w-full justify-start h-9 p-0 bg-transparent border-b rounded-none">
                                <TabsTrigger value="All" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 pb-2">All</TabsTrigger>
                                <TabsTrigger value="Refill" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 pb-2">Refills</TabsTrigger>
                                <TabsTrigger value="LabReview" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 pb-2">Labs</TabsTrigger>
                                <TabsTrigger value="SignNote" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 pb-2">Signatures</TabsTrigger>
                            </TabsList>
                        </div>

                        <ScrollArea className="flex-1 px-6 py-4">
                            <TabsContent value="All" className="mt-0"><TaskList filter="All" /></TabsContent>
                            <TabsContent value="Refill" className="mt-0"><TaskList filter="Refill" /></TabsContent>
                            <TabsContent value="LabReview" className="mt-0"><TaskList filter="LabReview" /></TabsContent>
                            <TabsContent value="SignNote" className="mt-0"><TaskList filter="SignNote" /></TabsContent>
                        </ScrollArea>
                    </Tabs>
                </CardContent>
            </Card>

            <SlideOver
                open={!!selectedTask}
                onClose={() => setSelectedTask(null)}
                title={selectedTask?.type === 'Refill' ? 'Refill Request' : selectedTask?.type === 'LabReview' ? 'Lab Results' : 'Sign Note'}
            >
                {selectedTask && (
                    <div className="space-y-6">
                        <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-lg border">
                            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
                                {selectedTask.patientName.split(' ').map(n => n[0]).join('')}
                            </div>
                            <div>
                                <h3 className="font-semibold text-lg">{selectedTask.patientName}</h3>
                                <p className="text-sm text-muted-foreground">DOB: 01/01/1980 • MRN: {selectedTask.id}</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Details</h4>
                            <div className="p-4 border rounded-lg bg-card">
                                <p className="font-medium">{selectedTask.details}</p>
                                <p className="text-sm text-muted-foreground mt-2">Requested today at 9:00 AM</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Actions</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <Button className="w-full" onClick={() => setSelectedTask(null)}>
                                    <CheckCircle2 className="mr-2 h-4 w-4" />
                                    Approve
                                </Button>
                                <Button variant="outline" className="w-full" onClick={() => setSelectedTask(null)}>
                                    <Clock className="mr-2 h-4 w-4" />
                                    Defer
                                </Button>
                            </div>
                            <Button variant="ghost" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50">
                                Deny Request
                            </Button>
                        </div>
                    </div>
                )}
            </SlideOver>
        </>
    )
}
