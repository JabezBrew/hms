import Search from 'lucide-react/dist/esm/icons/search.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Bed from 'lucide-react/dist/esm/icons/bed.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';

const DEFAULT_EMPTY_ARRAY = [];

import { cn } from '@/lib/utils';

/**
 * PatientSelectStep - Select patient for handoff
 */
export function PatientSelectStep({
  patients = DEFAULT_EMPTY_ARRAY,
  isLoading,
  selectedPatient,
  onSelectPatient,
  searchTerm,
  onSearchChange
}) {
  // Filter patients by search term
  const filteredPatients = patients.filter(p => {
    if (!searchTerm) return true;
    const name = p.patient_name?.toLowerCase() || '';
    const mrn = p.patient_mrn?.toLowerCase() || '';
    return name.includes(searchTerm.toLowerCase()) || mrn.includes(searchTerm.toLowerCase());
  });

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="space-y-2">
        <Label htmlFor="search" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Search Patients
        </Label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            id="search"
            placeholder="Search by name or MRN..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 font-mono"
          />
        </div>
      </div>

      {/* Patient List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <ScrollArea className="h-[450px]">
          <div className="space-y-3 pr-4">
            {filteredPatients.map((patient) => (
              <button
                type="button"
                key={patient.patient_id}
                onClick={() => onSelectPatient(patient)}
                className={cn(
                  "w-full p-4 rounded-xl border cursor-pointer transition-all text-left",
                  "hover:border-amber-500/50 hover:bg-amber-500/5",
                  selectedPatient?.patient_id === patient.patient_id
                    ? "border-amber-500 bg-amber-500/10"
                    : "border-border bg-card"
                )}
              >
                <div className="flex justify-between items-start gap-4">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "p-2 rounded-lg",
                      patient.is_critical ? "bg-rose-500/10" : "bg-muted"
                    )}>
                      <User className={cn(
                        "size-5",
                        patient.is_critical ? "text-rose-500" : "text-muted-foreground"
                      )} />
                    </div>
                    <div>
                      <h4 className="font-display text-lg font-medium">
                        {patient.patient_name}
                      </h4>
                      <p className="font-mono text-xs text-muted-foreground">
                        MRN: {patient.patient_mrn}
                      </p>
                      {patient.ward_name && (
                        <div className="flex items-center gap-1 mt-1">
                          <Bed className="size-3 text-muted-foreground" />
                          <span className="font-mono text-xs text-muted-foreground">
                            {patient.ward_name} - Bed {patient.bed_number}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 items-end">
                    {patient.is_critical && (
                      <Badge variant="destructive" className="font-mono text-[10px]">
                        <AlertTriangle className="size-3 mr-1" />
                        Critical
                      </Badge>
                    )}
                    {patient.active_alerts_count > 0 && (
                      <Badge variant="outline" className="font-mono text-[10px] border-amber-500/50 text-amber-600">
                        {patient.active_alerts_count} Alert{patient.active_alerts_count > 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            ))}

            {filteredPatients.length === 0 && (
              <div className="text-center py-12">
                <User className="size-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground font-mono text-sm">
                  {searchTerm ? 'No patients match your search' : 'No patients available'}
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
