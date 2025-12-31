import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUnitTypes } from '@/hooks/useOrganization';
import {
  Settings2,
  Search,
  Building2,
  ChevronLeft,
  Check,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * UnitTypesPage - Configuration page for unit types
 */
export default function UnitTypesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState(null);

  const { data: typesData, isLoading } = useUnitTypes();
  const types = typesData?.data?.results || typesData?.results || [];

  // Filter types based on search
  const filteredTypes = types.filter((type) =>
    type.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    type.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const CapabilityBadge = ({ enabled, label }) => (
    <div className="flex items-center gap-1.5">
      {enabled ? (
        <Check className="h-3.5 w-3.5 text-emerald-600" />
      ) : (
        <X className="h-3.5 w-3.5 text-muted-foreground/50" />
      )}
      <span className={cn(
        'text-xs',
        enabled ? 'text-foreground' : 'text-muted-foreground/50'
      )}>
        {label}
      </span>
    </div>
  );

  return (
    <>
      <Helmet>
        <title>Unit Types | HMS Admin</title>
      </Helmet>

      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/admin/organization">
              <ChevronLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Settings2 className="h-5 w-5 text-amber-700" />
            </div>
            <div>
              <h1 className="text-xl font-display font-semibold">Unit Types</h1>
              <p className="text-sm text-muted-foreground">
                Configure organizational unit types and their capabilities
              </p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search unit types..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 max-w-sm"
          />
        </div>

        {/* Table */}
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Name</TableHead>
                <TableHead className="w-[100px]">Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[250px]">Capabilities</TableHead>
                <TableHead className="w-[80px]">Level</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-8" /></TableCell>
                  </TableRow>
                ))
              ) : filteredTypes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    {searchQuery ? 'No unit types match your search' : 'No unit types configured'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredTypes.map((type) => (
                  <TableRow
                    key={type.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedType(type)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{type.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                        {type.code}
                      </code>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {type.description || '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {type.can_be_root && (
                          <Badge variant="outline" className="text-xs">Root</Badge>
                        )}
                        {type.can_admit_patients && (
                          <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">Admits</Badge>
                        )}
                        {type.can_consult && (
                          <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-200">Consults</Badge>
                        )}
                        {type.can_have_budget && (
                          <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">Budget</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm">{type.level}</span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Info */}
        <p className="text-xs text-muted-foreground mt-4">
          Unit types are configured via the seed_organization management command.
          Contact your system administrator to modify these settings.
        </p>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selectedType} onOpenChange={() => setSelectedType(null)}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {selectedType?.name}
            </SheetTitle>
          </SheetHeader>

          {selectedType && (
            <div className="mt-6 space-y-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <div>
                  <Label className="text-muted-foreground">Code</Label>
                  <div className="font-mono mt-1">{selectedType.code}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Level</Label>
                  <div className="mt-1">{selectedType.level}</div>
                </div>
                {selectedType.description && (
                  <div>
                    <Label className="text-muted-foreground">Description</Label>
                    <div className="mt-1 text-sm">{selectedType.description}</div>
                  </div>
                )}
              </div>

              {/* Capabilities */}
              <div>
                <Label className="text-muted-foreground mb-3 block">Capabilities</Label>
                <div className="space-y-3 bg-muted/50 rounded-lg p-4">
                  <CapabilityBadge enabled={selectedType.can_be_root} label="Can be root unit" />
                  <CapabilityBadge enabled={selectedType.can_admit_patients} label="Can admit patients" />
                  <CapabilityBadge enabled={selectedType.can_consult} label="Can receive consults" />
                  <CapabilityBadge enabled={selectedType.can_have_budget} label="Can have own budget" />
                  <CapabilityBadge enabled={selectedType.can_have_staff} label="Can have staff assignments" />
                  <CapabilityBadge enabled={selectedType.can_have_leadership} label="Can have leadership" />
                  <CapabilityBadge enabled={selectedType.can_own_wards} label="Can own wards" />
                </div>
              </div>

              {/* Read-only Notice */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-800">
                  Unit type configurations are read-only and managed through the backend seed command.
                  Contact your system administrator to make changes.
                </p>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
