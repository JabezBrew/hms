import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import UserCog from 'lucide-react/dist/esm/icons/user-cog.js';
import BedDouble from 'lucide-react/dist/esm/icons/bed-double.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import FolderTree from 'lucide-react/dist/esm/icons/folder-tree.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSlideOver } from '@/hooks/useSlideOver';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useClinicalUnitsTree,
  useClinicalUnit,
  useCreateClinicalUnit,
  useUpdateClinicalUnit,
  useDeleteClinicalUnit,
} from '@/features/admin/hooks';
import { UnitBreadcrumb } from '@/components/organization';
import { UnitForm } from './components/UnitForm';
import { LeadershipPanel } from './components/LeadershipPanel';
import { StaffPanel } from './components/StaffPanel';
import { OpsStaffPanel } from './components/OpsStaffPanel';
import { WardAllocationPanel } from './components/WardAllocationPanel';
import { ClinicsPanel } from './components/ClinicsPanel';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

import { toast } from 'sonner';

/**
 * TreeNode - Recursive component for rendering tree nodes
 * Uses Chronicle Design System styling
 */
function TreeNode({ node, level = 0, selectedId, onSelect, onAction, expandedIds, onToggleExpand }) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;

  const handleToggle = (e) => {
    e.stopPropagation();
    onToggleExpand(node.id);
  };

  const handleSelectKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onSelect(node.id);
  };

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-2 py-2.5 px-3 rounded-lg cursor-pointer transition-all duration-200',
          isSelected
            ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 shadow-sm'
            : 'hover:bg-muted/50 border border-transparent'
        )}
        style={{ paddingLeft: `${level * 20 + 12}px` }}
        onClick={() => onSelect(node.id)}
        onKeyDown={handleSelectKeyDown}
        role="treeitem"
        tabIndex={0}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
      >
        {/* Expand/Collapse Toggle */}
        <button
          type="button"
          onClick={handleToggle}
          className={cn(
            'p-0.5 rounded hover:bg-muted transition-colors',
            !hasChildren && 'invisible'
          )}
        >
          {isExpanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </button>

        {/* Icon */}
        <div
          className={cn(
            'flex size-8 items-center justify-center rounded-lg',
            isSelected
              ? 'bg-amber-100 dark:bg-amber-900/40'
              : 'bg-muted/80'
          )}
        >
          <Building2 className={cn(
            'size-4',
            isSelected ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
          )} />
        </div>

        {/* Name and Type */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              'font-display text-sm truncate',
              isSelected ? 'text-amber-900 dark:text-amber-100 font-semibold' : 'font-medium'
            )}>
              {node.name}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded shrink-0">
              {node.unit_type_name}
            </span>
          </div>
          {node.code && (
            <span className="font-mono text-[10px] text-muted-foreground">{node.code}</span>
          )}
        </div>

        {/* Status Badge */}
        {!node.is_active && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            Inactive
          </span>
        )}

        {/* Actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onAction('add-child', node)}>
              <Plus className="mr-2 size-4" />
              Add Child Unit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction('edit', node)}>
              <Pencil className="mr-2 size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onAction('delete', node)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onAction={onAction}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * UnitDetailPanel - Side panel showing unit details and related data
 * Uses Chronicle Design System styling
 */
function UnitDetailPanel({ unitId, onEdit }) {
  const [activeTab, setActiveTab] = useState('overview');
  const { data: unitData, isLoading } = useClinicalUnit(unitId);
  const unit = unitData?.data || unitData;
  const isOpsUnit = unit?.staffing_mode === 'ops_only';
  const isMixedUnit = unit?.staffing_mode === 'mixed';
  const staffTabLabel = isMixedUnit ? 'Staff' : isOpsUnit ? 'Operations Staff' : 'Clinical Staff';

  // Clinics tab only for departments/divisions
  const canHaveClinics = unit?.unit_type_code === 'department' || unit?.unit_type_code === 'division';

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Building2 },
    { id: 'leadership', label: 'Leadership', icon: UserCog },
    { id: 'staff', label: staffTabLabel, icon: Users },
    { id: 'wards', label: 'Wards', icon: BedDouble },
    ...(canHaveClinics ? [{ id: 'clinics', label: 'Clinics', icon: Stethoscope }] : []),
  ];

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (!unit) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Unit not found
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      {/* Header */}
      <div className="p-6 border-b bg-card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight">{unit.name}</h2>
            <UnitBreadcrumb unit={unit} showIcon={false} className="mt-1 font-mono text-xs text-muted-foreground" />
          </div>
          <Button variant="outline" size="sm" className="font-mono text-xs" onClick={() => onEdit(unit)}>
            <Pencil className="size-4 mr-2" />
            Edit
          </Button>
        </div>

        {/* Tabs */}
        <div className="-mb-px flex max-w-full gap-1 overflow-x-auto border-b [-webkit-overflow-scrolling:touch]">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-amber-500 text-amber-700 dark:text-amber-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Basic Info */}
            <section>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-4">
                Basic Information
              </h3>
              <dl className="grid gap-4 sm:grid-cols-2 sm:gap-6">
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Code</dt>
                  <dd className="font-mono text-sm">{unit.code}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Type</dt>
                  <dd className="text-sm">{unit.unit_type_name}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Status</dt>
                  <dd>
                    <span className={cn(
                      'inline-flex items-center font-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded',
                      unit.is_active
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground'
                    )}>
                      {unit.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </dd>
                </div>
                {unit.short_name && (
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Short Name</dt>
                    <dd className="text-sm">{unit.short_name}</dd>
                  </div>
                )}
              </dl>
            </section>

            {/* Divider */}
            <div className="divider-gradient" />

            {/* Location */}
            {(unit.location || unit.floor || unit.building) && (
              <>
                <section>
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-4">
                    Location
                  </h3>
                  <dl className="grid grid-cols-2 gap-6">
                    {unit.building && (
                      <div>
                        <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Building</dt>
                        <dd className="text-sm">{unit.building}</dd>
                      </div>
                    )}
                    {unit.floor && (
                      <div>
                        <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Floor</dt>
                        <dd className="text-sm">{unit.floor}</dd>
                      </div>
                    )}
                    {unit.location && (
                      <div className="col-span-2">
                        <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Details</dt>
                        <dd className="text-sm">{unit.location}</dd>
                      </div>
                    )}
                  </dl>
                </section>
                <div className="divider-gradient" />
              </>
            )}

            {/* Contact */}
            {(unit.phone || unit.email) && (
              <>
                <section>
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-4">
                    Contact
                  </h3>
                  <dl className="grid grid-cols-2 gap-6">
                    {unit.phone && (
                      <div>
                        <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Phone</dt>
                        <dd className="font-mono text-sm">{unit.phone}</dd>
                      </div>
                    )}
                    {unit.email && (
                      <div>
                        <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Email</dt>
                        <dd className="font-mono text-sm">{unit.email}</dd>
                      </div>
                    )}
                  </dl>
                </section>
                <div className="divider-gradient" />
              </>
            )}

            {/* Capabilities */}
            <section>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-4">
                Capabilities
              </h3>
              <div className="flex flex-wrap gap-2">
                {unit.accepts_admissions && (
                  <span className="badge-chronicle-emerald text-xs px-2.5 py-1 rounded-full">
                    Accepts Admissions
                  </span>
                )}
                {unit.accepts_referrals && (
                  <span className="badge-chronicle-sky text-xs px-2.5 py-1 rounded-full">
                    Accepts Referrals
                  </span>
                )}
                {unit.has_own_budget && (
                  <span className="badge-chronicle-amber text-xs px-2.5 py-1 rounded-full">
                    Own Budget
                  </span>
                )}
                {unit.operates_24_hours && (
                  <span className="badge-chronicle-rose text-xs px-2.5 py-1 rounded-full">
                    24/7 Operations
                  </span>
                )}
                {!unit.accepts_admissions && !unit.accepts_referrals && !unit.has_own_budget && !unit.operates_24_hours && (
                  <span className="text-sm text-muted-foreground">No special capabilities configured</span>
                )}
              </div>
            </section>

            {/* Description */}
            {unit.description && (
              <>
                <div className="divider-gradient" />
                <section>
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-4">
                    Description
                  </h3>
                  <p className="text-sm leading-relaxed">{unit.description}</p>
                </section>
              </>
            )}
          </div>
        )}

        {activeTab === 'leadership' && <LeadershipPanel unitId={unitId} />}
        {activeTab === 'staff' && (
          isMixedUnit ? (
            <div className="space-y-10">
              <StaffPanel unitId={unitId} />
              <div className="divider-gradient" />
              <OpsStaffPanel unitId={unitId} />
            </div>
          ) : (
            isOpsUnit ? <OpsStaffPanel unitId={unitId} /> : <StaffPanel unitId={unitId} />
          )
        )}
        {activeTab === 'wards' && <WardAllocationPanel unitId={unitId} unitType={unit?.unit_type_code} />}
        {activeTab === 'clinics' && <ClinicsPanel unitId={unitId} unitType={unit?.unit_type_code} />}
      </div>
    </div>
  );
}

/**
 * OrganizationPage - Main organization management page
 */
export default function OrganizationPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [editingUnitId, setEditingUnitId] = useState(null);
  const [parentForNewUnit, setParentForNewUnit] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Use slide-over hook for auto-collapsing sidebar
  const [showUnitForm, openUnitForm, closeUnitForm] = useSlideOver();

  const { data: treeData, isLoading, refetch } = useClinicalUnitsTree();
  // Fetch full unit details when editing (tree data doesn't include all fields)
  const { data: editingUnitData, isLoading: isLoadingEditUnit } = useClinicalUnit(editingUnitId, {
    enabled: !!editingUnitId,
  });
  const editingUnit = editingUnitData?.data || editingUnitData || null;
  const createUnit = useCreateClinicalUnit();
  const updateUnit = useUpdateClinicalUnit();
  const deleteUnit = useDeleteClinicalUnit();

  const tree = useMemo(() => treeData?.data || treeData || [], [treeData]);

  // Filter tree based on search
  const filteredTree = useMemo(() => {
    if (!searchQuery) return tree;

    const searchLower = searchQuery.toLowerCase();

    const filterNode = (node) => {
      const matches =
        node.name.toLowerCase().includes(searchLower) ||
        node.code?.toLowerCase().includes(searchLower);

      const filteredChildren = node.children
        ? node.children.flatMap((child) => {
          const filteredChild = filterNode(child);
          return filteredChild ? [filteredChild] : [];
        })
        : [];

      if (matches || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }
      return null;
    };

    return tree.flatMap((node) => {
      const filteredNode = filterNode(node);
      return filteredNode ? [filteredNode] : [];
    });
  }, [tree, searchQuery]);

  // Expand all when searching
  useMemo(() => {
    if (searchQuery) {
      const getAllIds = (nodes) => {
        const ids = new Set();
        const collect = (node) => {
          ids.add(node.id);
          node.children?.forEach(collect);
        };
        nodes.forEach(collect);
        return ids;
      };
      setExpandedIds(getAllIds(filteredTree));
    }
  }, [searchQuery, filteredTree]);

  const handleToggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Get all ancestor IDs for a node
  const getAncestorIds = (nodeId, nodes) => {
    const ancestors = new Set();
    const findPath = (currentNodes, targetId, path = []) => {
      for (const node of currentNodes) {
        if (node.id === targetId) {
          path.forEach(id => ancestors.add(id));
          return true;
        }
        if (node.children?.length) {
          if (findPath(node.children, targetId, [...path, node.id])) {
            return true;
          }
        }
      }
      return false;
    };
    findPath(nodes, nodeId);
    return ancestors;
  };

  const handleSelectUnit = (id) => {
    setSelectedUnitId(id);
    // Auto-expand the selected node and its ancestors
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(id); // Expand the selected node
      // Also expand all ancestors
      const ancestors = getAncestorIds(id, tree);
      ancestors.forEach(ancestorId => next.add(ancestorId));
      return next;
    });
  };

  const handleExpandAll = () => {
    const getAllIds = (nodes) => {
      const ids = new Set();
      const collect = (node) => {
        ids.add(node.id);
        node.children?.forEach(collect);
      };
      nodes.forEach(collect);
      return ids;
    };
    setExpandedIds(getAllIds(tree));
  };

  const handleCollapseAll = () => {
    setExpandedIds(new Set());
  };

  const handleAction = (action, node) => {
    switch (action) {
      case 'add-child':
        setParentForNewUnit(node);
        setEditingUnitId(null);
        openUnitForm();
        break;
      case 'edit':
        setEditingUnitId(node.id);
        setParentForNewUnit(null);
        openUnitForm();
        break;
      case 'delete':
        setDeleteConfirm(node);
        break;
    }
  };

  const handleCreateUnit = () => {
    setParentForNewUnit(null);
    setEditingUnitId(null);
    openUnitForm();
  };

  const handleSaveUnit = async (data) => {
    try {
      if (editingUnitId) {
        await updateUnit.mutateAsync({ id: editingUnitId, data });
        toast.success('Unit updated successfully');
      } else {
        if (parentForNewUnit) {
          data.parent = parentForNewUnit.id;
        }
        await createUnit.mutateAsync(data);
        toast.success('Unit created successfully');
      }
      closeUnitForm();
      setEditingUnitId(null);
      setParentForNewUnit(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save unit');
    }
  };

  const handleDeleteUnit = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteUnit.mutateAsync(deleteConfirm.id);
      toast.success('Unit deleted successfully');
      if (selectedUnitId === deleteConfirm.id) {
        setSelectedUnitId(null);
      }
      setDeleteConfirm(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete unit');
    }
  };

  const pageMeta = usePageMeta({
    title: 'Organization | HMS Admin',
    breadcrumbs: [
      { label: 'Admin', href: '/admin' },
      { label: 'Organization' },
    ],
  });

  return (
    <PageShell>
      {pageMeta}
      <div className="flex min-w-0 flex-col lg:h-[calc(100vh-4rem)] lg:flex-row">
        {/* Left Panel - Tree View */}
        <div className="flex max-h-[70vh] w-full min-w-0 flex-col border-b bg-card lg:max-h-none lg:w-[420px] lg:shrink-0 lg:border-b-0 lg:border-r">
          {/* Header */}
          <div className="p-5 border-b bg-background">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
                  <FolderTree className="size-5 text-amber-600 dark:text-amber-400" />
                </div>
                <h1 className="font-display text-xl font-semibold tracking-tight">Organization</h1>
              </div>
              <Button onClick={handleCreateUnit} size="sm" className="bg-amber-600 hover:bg-amber-700 text-white font-mono text-xs">
                <Plus className="size-4 mr-1.5" />
                Add Unit
              </Button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search units..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 font-mono text-sm"
              />
            </div>

            {/* Toolbar */}
            <div className="mt-3 flex flex-wrap items-center gap-1">
              <Button variant="ghost" size="sm" className="font-mono text-xs text-muted-foreground hover:text-foreground" onClick={handleExpandAll}>
                Expand All
              </Button>
              <Button variant="ghost" size="sm" className="font-mono text-xs text-muted-foreground hover:text-foreground" onClick={handleCollapseAll}>
                Collapse All
              </Button>
              <Button variant="ghost" size="icon" className="ml-auto size-8" onClick={() => refetch()}>
                <RefreshCw className="size-4 text-muted-foreground" />
              </Button>
            </div>
          </div>

          {/* Tree */}
          <div className="flex-1 overflow-y-auto p-3">
            {isLoading ? (
              <div className="space-y-2 p-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            ) : filteredTree.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/50 mb-4">
                  <Building2 className="size-8 text-muted-foreground/50" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? 'No units match your search' : 'No units yet'}
                </p>
                {!searchQuery && (
                  <p className="text-xs text-muted-foreground mt-1">Create your first organizational unit</p>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredTree.map((node) => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    selectedId={selectedUnitId}
                    onSelect={handleSelectUnit}
                    onAction={handleAction}
                    expandedIds={expandedIds}
                    onToggleExpand={handleToggleExpand}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Detail View */}
        <div className={cn(
          "min-w-0 flex-1 bg-muted/20",
          selectedUnitId ? "block" : "hidden lg:block"
        )}>
          {selectedUnitId ? (
            <UnitDetailPanel
              unitId={selectedUnitId}
              onClose={() => setSelectedUnitId(null)}
              onEdit={(unit) => {
                setEditingUnitId(unit.id);
                openUnitForm();
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="flex size-20 items-center justify-center rounded-2xl bg-muted/50 mb-4">
                <Building2 className="size-10 text-muted-foreground/30" />
              </div>
              <p className="text-muted-foreground">Select a unit to view details</p>
              <p className="text-xs text-muted-foreground/60 mt-1">or create a new organizational unit</p>
            </div>
          )}
        </div>
      </div>

      {/* Unit Form Slide-Over */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-[100] w-full sm:w-[500px] bg-background border-l border-border",
          "transform transition-transform duration-300 ease-in-out",
          "flex flex-col shadow-2xl",
          showUnitForm ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
              <Building2 className="size-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold">
                {editingUnitId ? 'Edit Unit' : 'Create Unit'}
              </h2>
              {parentForNewUnit && (
                <p className="font-mono text-xs text-muted-foreground">
                  Adding to {parentForNewUnit.name}
                </p>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={closeUnitForm}
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            <X className="size-5" />
          </Button>
        </header>

        {/* Content - scrollable */}
        <div className="flex-1 overflow-y-auto p-6">
          {editingUnitId && isLoadingEditUnit ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <UnitForm
              key={editingUnitId || 'new'}
              unit={editingUnit}
              parentUnit={parentForNewUnit}
              onSubmit={handleSaveUnit}
              onCancel={closeUnitForm}
              isLoading={createUnit.isPending || updateUnit.isPending}
            />
          )}
        </div>
      </div>

      {/* Backdrop */}
      {showUnitForm && (
        <button
          type="button"
          aria-label="Close unit form"
          className="fixed inset-0 z-[99] border-0 bg-black/10 p-0"
          onClick={closeUnitForm}
        />
      )}

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex size-10 items-center justify-center rounded-xl bg-rose-100 dark:bg-rose-900/30">
                <Trash2 className="size-5 text-rose-600 dark:text-rose-400" />
              </div>
              <DialogTitle className="font-display text-xl">Delete Unit</DialogTitle>
            </div>
            <DialogDescription className="text-sm">
              Are you sure you want to delete <span className="font-display font-medium">{deleteConfirm?.name}</span>?
              This will also delete all child units. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="font-mono text-xs">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteUnit}
              disabled={deleteUnit.isPending}
              className="font-mono text-xs"
            >
              {deleteUnit.isPending ? 'Deleting...' : 'Delete Unit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
