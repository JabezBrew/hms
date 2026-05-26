"use client"

import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import format from "date-fns/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { useState } from "react";

export function DatePicker({ id, date, setDate, className, placeholder = "Pick a date", dateFormat = "PP" }) {
    // Use props or fallback to internal state
    const [internalDate, setInternalDate] = useState(null);
    const currentDate = date !== undefined ? date : internalDate;
    const handleDateChange = setDate || setInternalDate;

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    id={id}
                    variant={"outline"}
                    className={cn(
                        "w-full justify-start text-left font-normal",
                        !currentDate && "text-muted-foreground",
                        className
                    )}
                >
                    <CalendarIcon className="mr-2 size-4 flex-shrink-0" />
                    <span className="truncate">
                        {currentDate ? format(currentDate, dateFormat) : placeholder}
                    </span>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 z-[200]" align="start">
                <Calendar
                    mode="single"
                    selected={currentDate}
                    onSelect={handleDateChange}
                    initialFocus
                />
            </PopoverContent>
        </Popover>
    )
}
