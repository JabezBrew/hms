"use client"

import * as React from "react"
import { DatePicker } from "@/components/ui/date-picker"

/**
 * DateRangePicker - A compound date picker for selecting date ranges
 *
 * Only triggers onChange when both dates are selected (complete range).
 * Works regardless of which date is selected first.
 *
 * @param {Object} props
 * @param {Date|null} props.from - Start date
 * @param {Date|null} props.to - End date
 * @param {Function} props.onChange - Called with {from, to} when range is complete or cleared
 * @param {string} props.fromPlaceholder - Placeholder for start date picker
 * @param {string} props.toPlaceholder - Placeholder for end date picker
 * @param {string} props.className - Additional class for the container
 * @param {string} props.pickerClassName - Class applied to each DatePicker
 * @param {string} props.separator - Text between the two pickers
 */
export function DateRangePicker({
  from = null,
  to = null,
  onChange,
  fromPlaceholder = "From",
  toPlaceholder = "To",
  className = "",
  pickerClassName = "w-[130px] font-mono text-xs",
  separator = "to",
}) {
  // Internal state for pending selections
  const [pendingFrom, setPendingFrom] = React.useState(from);
  const [pendingTo, setPendingTo] = React.useState(to);

  // Sync internal state with props when they change externally
  React.useEffect(() => {
    setPendingFrom(from);
    setPendingTo(to);
  }, [from, to]);

  const handleFromChange = (date) => {
    setPendingFrom(date);

    // If both dates will be set, trigger onChange
    if (date && pendingTo) {
      onChange?.({ from: date, to: pendingTo });
    }
    // If clearing and other is also clear, trigger onChange with null range
    else if (!date && !pendingTo) {
      onChange?.({ from: null, to: null });
    }
  };

  const handleToChange = (date) => {
    setPendingTo(date);

    // If both dates will be set, trigger onChange
    if (pendingFrom && date) {
      onChange?.({ from: pendingFrom, to: date });
    }
    // If clearing and other is also clear, trigger onChange with null range
    else if (!pendingFrom && !date) {
      onChange?.({ from: null, to: null });
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <DatePicker
        date={pendingFrom}
        setDate={handleFromChange}
        placeholder={fromPlaceholder}
        className={pickerClassName}
      />
      <span className="text-muted-foreground text-xs">{separator}</span>
      <DatePicker
        date={pendingTo}
        setDate={handleToChange}
        placeholder={toPlaceholder}
        className={pickerClassName}
      />
    </div>
  );
}
