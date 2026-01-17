import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js';
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { useFacilities } from "@/hooks/useFacilityQueries";
import { toast } from "sonner";

const DEFAULT_FACILITY_CODE = import.meta.env.VITE_DEFAULT_FACILITY_CODE || "";

export function FacilitySwitcher() {
  const { facilityCode, setFacilityCode } = useAuth();
  const [draft, setDraft] = useState(facilityCode || DEFAULT_FACILITY_CODE);
  const [searchQuery, setSearchQuery] = useState("");
  const multiFacilityMode =
    String(import.meta.env.VITE_MULTI_FACILITY_MODE || "").toLowerCase() === "true";
  const {
    data: facilities = [],
    isLoading,
    isError,
  } = useFacilities();

  const facilityOptions = useMemo(() => {
    return facilities.map((facility) => ({
      value: facility.code,
      label: `${facility.name} (${facility.code})`,
    }));
  }, [facilities]);

  const filteredOptions = useMemo(() => {
    if (!searchQuery) return facilityOptions;
    const normalized = searchQuery.toLowerCase();
    return facilityOptions.filter((option) =>
      option.label.toLowerCase().includes(normalized) ||
      option.value.toLowerCase().includes(normalized)
    );
  }, [facilityOptions, searchQuery]);

  useEffect(() => {
    setDraft(facilityCode || DEFAULT_FACILITY_CODE);
  }, [facilityCode]);

  const handleApply = () => {
    const normalized = draft ? draft.trim().toUpperCase() : "";
    if (!normalized) {
      toast.error("Facility code required");
      return;
    }
    setFacilityCode(normalized);
    toast.success("Facility context updated", {
      description: `Now operating in ${normalized}.`,
    });
  };

  const handleReset = () => {
    if (!DEFAULT_FACILITY_CODE) {
      toast.error("No default facility configured");
      return;
    }
    setDraft(DEFAULT_FACILITY_CODE);
    setFacilityCode(DEFAULT_FACILITY_CODE);
    toast.success("Facility reset", {
      description: `Default set to ${DEFAULT_FACILITY_CODE}.`,
    });
  };

  const handleFacilitySelect = (code) => {
    setDraft(code ? String(code).toUpperCase() : "");
    setSearchQuery("");
  };

  if (!multiFacilityMode) {
    return null;
  }
  if (!isLoading && facilities.length < 2 && !isError) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="font-mono text-xs">
          <Building2 className="h-3.5 w-3.5 mr-2" />
          {facilityCode || DEFAULT_FACILITY_CODE || "Facility"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Facility Context
        </DropdownMenuLabel>
        <div className="px-3 pb-2 pt-1 space-y-3">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Select Facility</Label>
            <Combobox
              options={filteredOptions}
              value={draft || ""}
              onChange={handleFacilitySelect}
              onInputChange={setSearchQuery}
              placeholder="Search facilities"
              emptyMessage={isError ? "Facility list unavailable." : "No facilities found."}
              isLoading={isLoading}
              displayValue={(value) => {
                const match = facilityOptions.find((option) => option.value === value);
                if (match) return match.label;
                return value ? value.toUpperCase() : "Select facility";
              }}
              className="font-mono text-xs"
              searchPlaceholder="Search by name or code"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Manual Code</Label>
            <div className="relative">
              <Building2 className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={draft || ""}
                onChange={(event) => setDraft(event.target.value.toUpperCase())}
                placeholder="FACILITY-CODE"
                className="pl-9 font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" className="font-mono text-xs" onClick={handleApply}>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Apply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="font-mono text-xs"
              onClick={handleReset}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Default
            </Button>
          </div>

          {DEFAULT_FACILITY_CODE && (
            <p className="text-xs text-muted-foreground">
              Default: {DEFAULT_FACILITY_CODE}
            </p>
          )}
          {isError && (
            <p className="text-xs text-rose-600">
              Facility list unavailable. Enter a code manually.
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <div className="px-3 pb-3 text-[11px] text-muted-foreground">
          Switch only if you have assigned access to the target facility.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
