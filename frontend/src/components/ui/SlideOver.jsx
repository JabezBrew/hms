import * as React from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function SlideOver({ open, onClose, title, header, children, className }) {
    // Handle escape key to close
    React.useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === "Escape") onClose()
        }
        if (open) {
            document.addEventListener("keydown", handleEscape)
            document.body.style.overflow = "hidden"
        }
        return () => {
            document.removeEventListener("keydown", handleEscape)
            document.body.style.overflow = "unset"
        }
    }, [open, onClose])

    return (
        <>
            {/* Backdrop */}
            <div
                className={cn(
                    "fixed inset-0 bg-background/80 backdrop-blur-sm z-50 transition-opacity duration-300",
                    open ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={onClose}
            />

            {/* Drawer */}
            <div
                className={cn(
                    "fixed inset-y-0 right-0 z-50 w-full sm:w-[500px] bg-background border-l shadow-lg transform transition-transform duration-300 ease-in-out",
                    open ? "translate-x-0" : "translate-x-full",
                    className
                )}
            >
                <div className="flex flex-col h-full">
                    {header ? (
                        header
                    ) : (
                        <div className="flex items-center justify-between p-4 border-b">
                            <h2 className="text-lg font-semibold">{title}</h2>
                            <Button variant="ghost" size="icon" onClick={onClose}>
                                <X className="h-4 w-4" />
                                <span className="sr-only">Close</span>
                            </Button>
                        </div>
                    )}
                    <div className="flex-1 overflow-y-auto p-4">
                        {children}
                    </div>
                </div>
            </div>
        </>
    )
}
