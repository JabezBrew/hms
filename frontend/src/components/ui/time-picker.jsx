"use client"

import Clock from 'lucide-react/dist/esm/icons/clock.js';
import * as React from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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

/**
 * TimePicker - A standalone time picker component
 *
 * @param {string} value - Time value in HH:mm format (24-hour)
 * @param {function} onChange - Callback with new time value in HH:mm format
 * @param {boolean} disabled - Whether the picker is disabled
 * @param {string} placeholder - Placeholder text
 * @param {string} className - Additional classes for the trigger button
 */
export function TimePicker({
  value,
  onChange,
  disabled = false,
  placeholder = "Select time",
  className,
  popoverClassName = "z-[400]"
}) {
  const [open, setOpen] = React.useState(false)

  // Parse value into hours, minutes, period
  const parseTime = (timeStr) => {
    if (!timeStr) return { hours: "09", minutes: "00", period: "AM" }

    const [hoursStr, minutesStr] = timeStr.split(":")
    const hours24 = parseInt(hoursStr, 10)
    const minutes = minutesStr || "00"

    const period = hours24 >= 12 ? "PM" : "AM"
    const hours12 = hours24 % 12 || 12

    return {
      hours: hours12.toString().padStart(2, "0"),
      minutes: minutes.padStart(2, "0"),
      period
    }
  }

  const { hours, minutes, period } = parseTime(value)

  // Convert 12-hour to 24-hour format and call onChange
  const handleTimeChange = (type, newValue) => {
    let newHours = parseInt(hours, 10)
    let newMinutes = minutes
    let newPeriod = period

    if (type === "hours") {
      newHours = parseInt(newValue, 10)
    } else if (type === "minutes") {
      newMinutes = newValue
    } else if (type === "period") {
      newPeriod = newValue
    }

    // Convert to 24-hour format
    let hours24 = newHours
    if (newPeriod === "PM" && newHours < 12) {
      hours24 = newHours + 12
    } else if (newPeriod === "AM" && newHours === 12) {
      hours24 = 0
    }

    const newTimeStr = `${hours24.toString().padStart(2, "0")}:${newMinutes}`
    onChange?.(newTimeStr)
  }

  // Format display value
  const formatDisplay = () => {
    if (!value) return null
    return `${hours}:${minutes} ${period}`
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-mono text-sm",
            !value && "text-muted-foreground",
            disabled && "opacity-50 cursor-not-allowed",
            className
          )}
          disabled={disabled}
        >
          <Clock className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
          {formatDisplay() || <span className="text-muted-foreground">{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-auto p-3", popoverClassName)}
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={16}
        avoidCollisions={true}
      >
        <div className="flex items-center gap-2">
          {/* Hours */}
          <Select
            value={hours}
            onValueChange={(val) => handleTimeChange("hours", val)}
            disabled={disabled}
          >
            <SelectTrigger className="w-[70px] font-mono text-sm">
              <SelectValue placeholder="HH" />
            </SelectTrigger>
            <SelectContent className="max-h-[200px] z-[500]">
              {Array.from({ length: 12 }, (_, i) => {
                const hour = (i + 1).toString().padStart(2, "0")
                return (
                  <SelectItem key={hour} value={hour} className="font-mono">
                    {hour}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>

          <span className="text-muted-foreground font-mono">:</span>

          {/* Minutes */}
          <Select
            value={minutes}
            onValueChange={(val) => handleTimeChange("minutes", val)}
            disabled={disabled}
          >
            <SelectTrigger className="w-[70px] font-mono text-sm">
              <SelectValue placeholder="MM" />
            </SelectTrigger>
            <SelectContent className="max-h-[200px] z-[500]">
              {Array.from({ length: 12 }, (_, i) => {
                const minute = (i * 5).toString().padStart(2, "0")
                return (
                  <SelectItem key={minute} value={minute} className="font-mono">
                    {minute}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>

          {/* AM/PM */}
          <Select
            value={period}
            onValueChange={(val) => handleTimeChange("period", val)}
            disabled={disabled}
          >
            <SelectTrigger className="w-[70px] font-mono text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[500]">
              <SelectItem value="AM" className="font-mono">AM</SelectItem>
              <SelectItem value="PM" className="font-mono">PM</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Quick select presets */}
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Quick select</p>
          <div className="flex flex-wrap gap-1">
            {["08:00", "09:00", "12:00", "13:00", "17:00", "18:00"].map((preset) => {
              const { hours: h, minutes: m, period: p } = parseTime(preset)
              return (
                <Button
                  key={preset}
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 font-mono text-xs"
                  onClick={() => {
                    onChange?.(preset)
                    setOpen(false)
                  }}
                >
                  {h}:{m} {p}
                </Button>
              )
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
