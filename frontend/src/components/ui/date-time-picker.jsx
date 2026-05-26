"use client"

import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import ClockIcon from 'lucide-react/dist/esm/icons/clock.js';
import format from "date-fns/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"
import { useState } from "react"

function getTimeParts(value) {
    if (!value) {
        return { hours: "12", minutes: "00", period: "AM" };
    }

    const dateHours = value.getHours();
    const hours12 = dateHours % 12 || 12;
    const period = dateHours >= 12 ? "PM" : "AM";

    return {
        hours: hours12.toString(),
        minutes: value.getMinutes().toString().padStart(2, "0"),
        period,
    };
}

export function DateTimePicker({ date, setDate, disabled = false }) {
    // Use props or fallback to internal state
    const [internalDate, setInternalDate] = useState(null);
    const currentDate = date !== undefined ? date : internalDate;

    const { hours, minutes, period } = getTimeParts(currentDate);

    // Handle date change
    const handleDateChange = (newDate) => {
        if (!newDate) {
            (setDate || setInternalDate)(null);
            return;
        }

        // Preserve the time from the current date or set to current time
        const updatedDate = new Date(newDate);

        if (currentDate) {
            updatedDate.setHours(currentDate.getHours());
            updatedDate.setMinutes(currentDate.getMinutes());
            updatedDate.setSeconds(currentDate.getSeconds());
        } else {
            // Default to current time if no time was previously set
            const now = new Date();
            updatedDate.setHours(now.getHours());
            updatedDate.setMinutes(now.getMinutes());
            updatedDate.setSeconds(now.getSeconds());
        }

        (setDate || setInternalDate)(updatedDate);
    };

    // Handle time change
    const handleTimeChange = (type, value) => {
        const updatedDate = new Date(currentDate || new Date());

        if (type === "hours") {
            // Convert 12-hour format to 24-hour format
            let hours24 = parseInt(value);
            if (period === "PM" && hours24 < 12) {
                hours24 += 12;
            } else if (period === "AM" && hours24 === 12) {
                hours24 = 0;
            }
            updatedDate.setHours(hours24);
        } else if (type === "minutes") {
            updatedDate.setMinutes(parseInt(value));
        } else if (type === "period") {
            let hours24 = parseInt(hours);
            if (value === "PM" && hours24 < 12) {
                hours24 += 12;
            } else if (value === "AM" && hours24 === 12) {
                hours24 = 0;
            } else if (value === "AM" && hours24 > 12) {
                hours24 -= 12;
            }
            updatedDate.setHours(hours24);
        }

        (setDate || setInternalDate)(updatedDate);
    };

    // Generate hours options (1-12)
    const hoursOptions = Array.from({ length: 12 }, (_, i) => {
        const hour = i + 1;
        return (
            <SelectItem key={hour} value={hour.toString()}>
                {hour.toString().padStart(2, '0')}
            </SelectItem>
        );
    });

    // Generate minutes options (00-59)
    const minutesOptions = Array.from({ length: 60 }, (_, i) => {
        const minute = i;
        const minuteStr = minute.toString().padStart(2, '0');
        return (
            <SelectItem key={minute} value={minuteStr}>
                {minuteStr}
            </SelectItem>
        );
    });

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant={"outline"}
                    className={cn(
                        "w-full justify-start text-left font-normal",
                        !currentDate && "text-muted-foreground",
                        disabled && "opacity-50 cursor-not-allowed"
                    )}
                    disabled={disabled}
                >
                    <CalendarIcon className="mr-2 size-4" />
                    {currentDate ? format(currentDate, "PPP p") : <span>Pick date and time</span>}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                    mode="single"
                    selected={currentDate}
                    onSelect={handleDateChange}
                    initialFocus
                    disabled={disabled}
                />
                <div className="border-t p-3 flex items-center gap-2">
                    <ClockIcon className="size-4 text-muted-foreground" />
                    <div className="flex items-center gap-1">
                        <Select
                            value={hours}
                            onValueChange={(value) => handleTimeChange("hours", value)}
                            disabled={disabled}
                        >
                            <SelectTrigger className="w-[60px]">
                                <SelectValue placeholder="Hour" />
                            </SelectTrigger>
                            <SelectContent>
                                {hoursOptions}
                            </SelectContent>
                        </Select>
                        <span className="text-muted-foreground">:</span>
                        <Select
                            value={minutes}
                            onValueChange={(value) => handleTimeChange("minutes", value)}
                            disabled={disabled}
                        >
                            <SelectTrigger className="w-[60px]">
                                <SelectValue placeholder="Min" />
                            </SelectTrigger>
                            <SelectContent>
                                {minutesOptions}
                            </SelectContent>
                        </Select>
                        <Select
                            value={period}
                            onValueChange={(value) => handleTimeChange("period", value)}
                            disabled={disabled}
                        >
                            <SelectTrigger className="w-[60px]">
                                <SelectValue placeholder="AM/PM" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="AM">AM</SelectItem>
                                <SelectItem value="PM">PM</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
