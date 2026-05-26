import X from 'lucide-react/dist/esm/icons/x.js';
import * as React from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function SlideOver({ open, onClose, title, header, children, className }) {
    const slideOverRef = React.useRef(null)
    const previousActiveElement = React.useRef(null)

    // Handle escape key to close and focus management
    React.useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === "Escape") onClose()
        }
        if (open) {
            // Store the previously focused element
            previousActiveElement.current = document.activeElement
            document.addEventListener("keydown", handleEscape)
            document.body.style.overflow = "hidden"
            // Focus the slide-over when it opens
            setTimeout(() => {
                slideOverRef.current?.focus()
            }, 100)
        }
        return () => {
            document.removeEventListener("keydown", handleEscape)
            document.body.style.overflow = "unset"
            // Restore focus when closing
            if (previousActiveElement.current) {
                previousActiveElement.current.focus()
            }
        }
    }, [open, onClose])

    return (
        <>
            {/* Backdrop */}
            <div
                role="presentation"
                className={cn(
                    "fixed inset-0 bg-background/80 backdrop-blur-sm z-50 transition-opacity duration-300",
                    open ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Drawer */}
            <div
                ref={slideOverRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="slideover-title"
                tabIndex={-1}
                className={cn(
                    "fixed inset-y-0 right-0 z-50 w-full sm:w-[500px] bg-background border-l shadow-lg transform transition-transform duration-300 ease-in-out focus:outline-none",
                    open ? "translate-x-0" : "translate-x-full",
                    className
                )}
            >
                <div className="flex flex-col h-full">
                    {header ? (
                        header
                    ) : (
                        <div className="flex items-center justify-between p-4 border-b">
                            <h2 id="slideover-title" className="text-lg font-semibold">{title}</h2>
                            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close panel">
                                <X className="size-4" aria-hidden="true" />
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
