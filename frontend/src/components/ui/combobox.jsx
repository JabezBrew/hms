import { useState, useRef, useEffect } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

const Combobox = ({
  options = [],
  value,
  onChange,
  onInputChange,
  placeholder = "Select an option",
  emptyMessage = "No results found.",
  disabled = false,
  className,
  displayValue,
  maxHeight = "15rem",
  searchPlaceholder = "Search...",
  isLoading = false,
}) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef(null);

  // Focus input when popover opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [open]);

  // Get the display value for the selected option
  const getDisplayValue = () => {
    if (!value) return placeholder;

    const selectedOption = options.find((option) => option.value === value);
    if (!selectedOption) return placeholder;

    return displayValue ? displayValue(value) : selectedOption.label;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between",
            !value && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <span className="truncate">{getDisplayValue()}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start" sideOffset={5}>
        <Command className="w-full">
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <CommandInput
              ref={inputRef}
              placeholder={searchPlaceholder}
              value={searchQuery}
              onValueChange={(value) => {
                setSearchQuery(value);
                if (onInputChange) {
                  onInputChange(value);
                }
              }}
              className="h-9 border-0 outline-none focus:ring-0"
            />
            {isLoading && (
              <div className="flex items-center">
                <svg className="animate-spin h-4 w-4 ml-2 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            )}
          </div>
          <ScrollArea style={{ maxHeight }}>
            <CommandList>
              <CommandEmpty>{isLoading ? "Searching..." : emptyMessage}</CommandEmpty>
              <CommandGroup>
                {options.map(opt => (
                    <CommandItem
                        key={opt.value}
                        /* IMPORTANT: put the searchable text in `value`, not the numeric id */
                        value={opt.label}
                        onSelect={() => {
                          onChange(opt.value === value ? null : opt.value);
                          setOpen(false);
                          setSearchQuery("");
                        }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", value === opt.value ? "opacity-100" : "opacity-0")} />
                      {opt.label}
                    </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </ScrollArea>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export { Combobox };
