import Crown from 'lucide-react/dist/esm/icons/crown.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import UserCog from 'lucide-react/dist/esm/icons/user-cog.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
import { useLeadershipRoles } from '@/features/admin/hooks';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

import { Link } from 'react-router-dom';

/**
 * LeadershipRolesPage - Configuration page for leadership roles
 */
export default function LeadershipRolesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState(null);

  const { data: rolesData, isLoading } = useLeadershipRoles();
  const roles = rolesData?.data?.results || rolesData?.results || [];

  // Filter roles based on search
  const filteredRoles = roles.filter((role) =>
    role.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    role.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pageMeta = usePageMeta({
    title: 'Leadership Roles | HMS Admin',
    breadcrumbs: [
      { label: 'Admin', href: '/admin' },
      { label: 'Organization', href: '/admin/organization' },
      { label: 'Leadership Roles' },
    ],
  });

  const CapabilityBadge = ({ enabled, label, icon: Icon }) => (
    <div className="flex items-center gap-2">
      {enabled ? (
        <Check className="h-3.5 w-3.5 text-emerald-600" />
      ) : (
        <X className="h-3.5 w-3.5 text-muted-foreground/50" />
      )}
      {Icon && <Icon className={cn('h-4 w-4', enabled ? 'text-foreground' : 'text-muted-foreground/50')} />}
      <span className={cn(
        'text-sm',
        enabled ? 'text-foreground' : 'text-muted-foreground/50'
      )}>
        {label}
      </span>
    </div>
  );

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title={(
          <span className="inline-flex items-center gap-3">
            <span className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Crown className="h-5 w-5 text-amber-700" />
            </span>
            <span>Leadership Roles</span>
          </span>
        )}
        description="Configure leadership roles and their permissions"
        actions={(
          <Button variant="ghost" size="icon" asChild>
            <Link to="/admin/organization" aria-label="Back to organization">
              <ChevronLeft className="h-5 w-5" />
            </Link>
          </Button>
        )}
      />

      <div className="p-6 max-w-6xl mx-auto">

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search leadership roles..."
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
                <TableHead className="w-[300px]">Permissions</TableHead>
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
                  </TableRow>
                ))
              ) : filteredRoles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                    {searchQuery ? 'No roles match your search' : 'No leadership roles configured'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredRoles.map((role) => (
                  <TableRow
                    key={role.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedRole(role)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserCog className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{role.name}</span>
                        {role.is_primary_leader && (
                          <Crown className="h-3.5 w-3.5 text-amber-500" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                        {role.code}
                      </code>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {role.description || '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {role.can_approve && (
                          <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                            <ClipboardCheck className="h-3 w-3 mr-1" />
                            Approve
                          </Badge>
                        )}
                        {role.can_manage_staff && (
                          <Badge variant="outline" className="text-xs bg-sky-50 text-sky-700 border-sky-200">
                            <Users className="h-3 w-3 mr-1" />
                            Staff
                          </Badge>
                        )}
                        {role.can_manage_budget && (
                          <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                            Budget
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Info */}
        <p className="text-xs text-muted-foreground mt-4">
          Leadership roles are configured via the seed_organization management command.
          Contact your system administrator to modify these settings.
        </p>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selectedRole} onOpenChange={() => setSelectedRole(null)}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              {selectedRole?.name}
              {selectedRole?.is_primary_leader && (
                <Crown className="h-4 w-4 text-amber-500" />
              )}
            </SheetTitle>
          </SheetHeader>

          {selectedRole && (
            <div className="mt-6 space-y-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <div>
                  <Label className="text-muted-foreground">Code</Label>
                  <div className="font-mono mt-1">{selectedRole.code}</div>
                </div>
                {selectedRole.description && (
                  <div>
                    <Label className="text-muted-foreground">Description</Label>
                    <div className="mt-1 text-sm">{selectedRole.description}</div>
                  </div>
                )}
              </div>

              {/* Leadership Type */}
              <div>
                <Label className="text-muted-foreground mb-3 block">Leadership Type</Label>
                <div className="bg-muted/50 rounded-lg p-4">
                  {selectedRole.is_primary_leader ? (
                    <div className="flex items-center gap-2 text-amber-700">
                      <Crown className="h-5 w-5" />
                      <span className="font-medium">Primary Leader</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <UserCog className="h-5 w-5" />
                      <span>Supporting Role</span>
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground mt-2">
                    {selectedRole.is_primary_leader
                      ? 'This role is the main leadership position for a unit.'
                      : 'This role supports the primary leader in unit management.'}
                  </p>
                </div>
              </div>

              {/* Permissions */}
              <div>
                <Label className="text-muted-foreground mb-3 block">Permissions</Label>
                <div className="space-y-3 bg-muted/50 rounded-lg p-4">
                  <CapabilityBadge
                    enabled={selectedRole.can_approve}
                    label="Can approve requests and documents"
                    icon={ClipboardCheck}
                  />
                  <CapabilityBadge
                    enabled={selectedRole.can_manage_staff}
                    label="Can manage unit staff assignments"
                    icon={Users}
                  />
                  <CapabilityBadge
                    enabled={selectedRole.can_manage_budget}
                    label="Can manage unit budget"
                    icon={Shield}
                  />
                </div>
              </div>

              {/* Read-only Notice */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-800">
                  Leadership role configurations are read-only and managed through the backend seed command.
                  Contact your system administrator to make changes.
                </p>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
