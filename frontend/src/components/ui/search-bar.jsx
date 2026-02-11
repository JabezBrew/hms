import Search from 'lucide-react/dist/esm/icons/search.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import { useState, useRef, useEffect } from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

const SearchBar = ({
  options = [],
  value,
  onChange,
  onInputChange,
  placeholder = "Search...",
  emptyMessage = "No results found.",
  disabled = false,
  className,
  displayValue,
  maxHeight = "15rem",
  searchPlaceholder = "Type to search...",
  isLoading = false,
}) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef(null);
  const selectedOption = options.find((option) => option.value === value);

  // Focus input when popover opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [open]);

  // Handle input change
  const handleInputChange = (value) => {
    setSearchQuery(value);
    if (onInputChange) {
      onInputChange(value);
    }
    // Open the popover when typing
    if (value && !open) {
      setOpen(true);
    }
  };

  // Handle option selection
  const handleSelect = (optionValue) => {
    onChange(optionValue === value ? null : optionValue);
    setOpen(false);
    setSearchQuery("");
  };

  // Handle clear button click
  const handleClear = (e) => {
    e.stopPropagation(); // Prevent opening the popover
    onChange(null);
    setSearchQuery("");
    if (onInputChange) {
      onInputChange("");
    }
  };

  return (
    <div className={cn("relative w-full", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="flex items-center">
            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={selectedOption ? displayValue ? displayValue(value) : selectedOption.label : searchQuery}
                onChange={(e) => {
                  if (!selectedOption) {
                    handleInputChange(e.target.value);
                  }
                }}
                placeholder={placeholder}
                className={cn(
                  "pl-10 pr-10",
                  selectedOption && "bg-muted text-muted-foreground"
                )}
                disabled={disabled}
              />
              {(selectedOption || searchQuery) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-0 hover:bg-transparent"
                  onClick={(e) => handleClear(e)}
                  disabled={disabled}
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                  <span className="sr-only">Clear</span>
                </Button>
              )}
            </div>
          </div>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[var(--radix-popover-trigger-width)] z-[400]"
          align="start"
          sideOffset={5}
        >
          <Command className="w-full" shouldFilter={false}>
            <ScrollArea style={{ maxHeight }}>
              <CommandList>
                <CommandEmpty>
                  {isLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
                      <span>Searching...</span>
                    </div>
                  ) : (
                    emptyMessage
                  )}
                </CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.label}
                      onSelect={() => handleSelect(option.value)}
                      className="flex items-center"
                    >
                      {option.icon && (
                        <div className="mr-2">{option.icon}</div>
                      )}
                      <div className="flex-grow truncate">{option.label}</div>
                      {value === option.value && (
                        <div className="ml-2 flex h-4 w-4 items-center justify-center">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                          >
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        </div>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </ScrollArea>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export { SearchBar };
