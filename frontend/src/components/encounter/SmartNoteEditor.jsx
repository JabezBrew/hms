import { useState, useRef, useEffect } from "react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
    Bold, Italic, List, ListOrdered,
    Sparkles, Mic, ChevronDown
} from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function SmartNoteEditor() {
    const [content, setContent] = useState("")
    const textareaRef = useRef(null)

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "inherit"
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
        }
    }, [content])

    const insertText = (text) => {
        setContent(prev => prev + text)
        textareaRef.current?.focus()
    }

    return (
        <Card className="border-none shadow-none">
            <div className="flex items-center gap-1 p-2 border-b sticky top-0 bg-background z-10">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Bold className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Italic className="h-4 w-4" />
                </Button>
                <div className="w-px h-4 bg-border mx-1" />
                <Button variant="ghost" size="icon" className="h-8 w-8">
                    <List className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                    <ListOrdered className="h-4 w-4" />
                </Button>
                <div className="flex-1" />

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2 text-purple-600 border-purple-200 hover:bg-purple-50">
                            <Sparkles className="h-3 w-3" />
                            AI Templates
                            <ChevronDown className="h-3 w-3" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => insertText("\n# History of Present Illness\nPatient presents with...")}>
                            HPI Generator
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => insertText("\n# Assessment & Plan\n1. Hypertension\n   - Continue current meds\n   - Monitor BP daily\n")}>
                            Standard A&P
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                    <Mic className="h-4 w-4" />
                </Button>
            </div>

            <CardContent className="p-0">
                <Textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Type '/' for commands..."
                    className="min-h-[500px] resize-none border-none focus-visible:ring-0 p-6 text-base leading-relaxed font-mono"
                />
            </CardContent>
        </Card>
    )
}
