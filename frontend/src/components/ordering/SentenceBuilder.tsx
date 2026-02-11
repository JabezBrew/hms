import Plus from 'lucide-react/dist/esm/icons/plus.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

export function SentenceBuilder() {
    const [orders, setOrders] = useState([])
    const [currentOrder, setCurrentOrder] = useState({
        drug: "",
        dose: "",
        route: "PO",
        frequency: "Daily",
        duration: "30 days"
    })

    const addOrder = () => {
        if (currentOrder.drug && currentOrder.dose) {
            setOrders([...orders, { ...currentOrder, id: Date.now() }])
            setCurrentOrder({
                drug: "",
                dose: "",
                route: "PO",
                frequency: "Daily",
                duration: "30 days"
            })
        }
    }

    const removeOrder = (id) => {
        setOrders(orders.filter(o => o.id !== id))
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">New Prescription</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap items-center gap-2 text-lg leading-relaxed">
                        <span className="font-medium text-muted-foreground">Dispense</span>

                        <Input
                            placeholder="Drug Name (e.g. Lisinopril)"
                            className="w-[200px] border-b-2 border-t-0 border-x-0 rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary bg-transparent text-center"
                            value={currentOrder.drug}
                            onChange={(e) => setCurrentOrder({ ...currentOrder, drug: e.target.value })}
                        />

                        <Input
                            placeholder="Dose (e.g. 10mg)"
                            className="w-[120px] border-b-2 border-t-0 border-x-0 rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary bg-transparent text-center"
                            value={currentOrder.dose}
                            onChange={(e) => setCurrentOrder({ ...currentOrder, dose: e.target.value })}
                        />

                        <Select value={currentOrder.route} onValueChange={(v) => setCurrentOrder({ ...currentOrder, route: v })}>
                            <SelectTrigger className="w-[100px] border-none bg-muted/50 rounded-md h-8">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="PO">PO</SelectItem>
                                <SelectItem value="IV">IV</SelectItem>
                                <SelectItem value="IM">IM</SelectItem>
                            </SelectContent>
                        </Select>

                        <span className="font-medium text-muted-foreground">taken</span>

                        <Select value={currentOrder.frequency} onValueChange={(v) => setCurrentOrder({ ...currentOrder, frequency: v })}>
                            <SelectTrigger className="w-[140px] border-none bg-muted/50 rounded-md h-8">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Daily">Daily</SelectItem>
                                <SelectItem value="BID">Twice Daily</SelectItem>
                                <SelectItem value="TID">Three Times Daily</SelectItem>
                                <SelectItem value="Q4H">Every 4 Hours</SelectItem>
                            </SelectContent>
                        </Select>

                        <span className="font-medium text-muted-foreground">for</span>

                        <Input
                            placeholder="Duration"
                            className="w-[100px] border-b-2 border-t-0 border-x-0 rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary bg-transparent text-center"
                            value={currentOrder.duration}
                            onChange={(e) => setCurrentOrder({ ...currentOrder, duration: e.target.value })}
                        />
                    </div>
                </CardContent>
                <CardFooter>
                    <Button onClick={addOrder} disabled={!currentOrder.drug || !currentOrder.dose} className="w-full sm:w-auto">
                        <Plus className="mr-2 h-4 w-4" />
                        Add to List
                    </Button>
                </CardFooter>
            </Card>

            {orders.length > 0 && (
                <div className="space-y-3">
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Pending Orders</h3>
                    {orders.map(order => (
                        <div key={order.id} className="flex items-center justify-between p-4 rounded-lg border bg-card">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-primary">{order.drug} {order.dose}</span>
                                <span className="text-muted-foreground">{order.route} {order.frequency} for {order.duration}</span>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => removeOrder(order.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                    <div className="flex justify-end pt-4">
                        <Button size="lg">Sign & Send Orders ({orders.length})</Button>
                    </div>
                </div>
            )}
        </div>
    )
}
