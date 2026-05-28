/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
/**
 * ChartTemplateListPage - Browse and manage chart templates
 *
 * Chronicle-styled page for viewing all available chart templates
 * with search, filtering, and management actions.
 */

import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import MoreVertical from 'lucide-react/dist/esm/icons/ellipsis-vertical.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import Copy from 'lucide-react/dist/esm/icons/copy.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import VirtualizedTable from "@/components/ui/VirtualizedTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { toast } from "sonner";
import {
  useChartTemplates,
  useChartCategories,
  useDeleteChartTemplate,
  useCloneChartTemplate,
  useUpdateChartTemplate,
} from "@/features/charts/hooks";
import { PageHeader } from "@/shared/components/page/PageHeader";
import { PageShell } from "@/shared/components/page/PageShell";
import { isRustV2ApiMode } from "@/lib/api/v2/runtime";

function ChartTemplatesHeader({ onCreate, showCreateAction }) {
  return (
    <PageHeader
      title={(
        <span className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/30">
            <ClipboardList className="size-6 text-amber-600 dark:text-amber-400" />
          </span>
          Chart Templates
        </span>
      )}
      description="Create and manage clinical monitoring charts"
      descriptionClassName="font-mono text-xs text-muted-foreground"
      actions={showCreateAction ? (
        <Button
          onClick={onCreate}
          className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
          data-onboarding="chart-template-create"
        >
          <Plus className="size-4 mr-1.5" />
          New Template
        </Button>
      ) : null}
      contentClassName="max-w-7xl mx-auto w-full"
    />
  );
}

function ChartTemplateUnavailableState() {
  return (
    <PageShell>
      <ChartTemplatesHeader showCreateAction={false} />

      <div className="max-w-7xl mx-auto px-6 py-8">
        <Alert>
          <ClipboardList className="size-4" />
          <AlertDescription>
            Chart template management is not available in Rust V2 mode yet because no generated /api/v2 chart-builder contract exists.
          </AlertDescription>
        </Alert>
      </div>
    </PageShell>
  );
}

function ChartTemplateFilters({
  searchQuery,
  categoryFilter,
  visibilityFilter,
  activeFilter,
  categories,
  onSearchChange,
  onCategoryChange,
  onVisibilityChange,
  onActiveChange,
  onClearFilters,
}) {
  const hasFilters = categoryFilter || visibilityFilter || activeFilter || searchQuery;

  return (
    <div className="border-b border-border bg-muted/30">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              className="pl-9 font-mono"
            />
          </div>

          <Select value={categoryFilter || "all"} onValueChange={onCategoryChange}>
            <SelectTrigger className="w-[160px] font-mono">
              <Filter className="size-3.5 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent className="z-[200]">
              <SelectItem value="all" className="font-mono">
                All categories
              </SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.value} value={cat.value} className="font-mono">
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={visibilityFilter || "all"} onValueChange={onVisibilityChange}>
            <SelectTrigger className="w-[140px] font-mono">
              <SelectValue placeholder="Visibility" />
            </SelectTrigger>
            <SelectContent className="z-[200]">
              <SelectItem value="all" className="font-mono">
                All visibility
              </SelectItem>
              <SelectItem value="private" className="font-mono">
                Private
              </SelectItem>
              <SelectItem value="role" className="font-mono">
                Role
              </SelectItem>
              <SelectItem value="department" className="font-mono">
                Department
              </SelectItem>
              <SelectItem value="facility" className="font-mono">
                Facility
              </SelectItem>
            </SelectContent>
          </Select>

          <Select value={activeFilter || "all"} onValueChange={onActiveChange}>
            <SelectTrigger className="w-[120px] font-mono">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="z-[200]">
              <SelectItem value="all" className="font-mono">
                All status
              </SelectItem>
              <SelectItem value="active" className="font-mono">
                Active
              </SelectItem>
              <SelectItem value="inactive" className="font-mono">
                Inactive
              </SelectItem>
            </SelectContent>
          </Select>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="font-mono text-xs text-muted-foreground"
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChartTemplateActionsMenu({
  template,
  onEdit,
  onClone,
  onToggleActive,
  onDelete,
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
        <Button variant="outline" size="sm" className="size-8 p-0 bg-card">
          <MoreVertical className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[200]">
        <DropdownMenuItem onClick={() => onEdit(template)}>
          <Pencil className="size-3.5 mr-2" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onClone(template)}>
          <Copy className="size-3.5 mr-2" />
          Clone
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onToggleActive(template)}>
          {template.is_active ? (
            <>
              <EyeOff className="size-3.5 mr-2" />
              Deactivate
            </>
          ) : (
            <>
              <Eye className="size-3.5 mr-2" />
              Activate
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onDelete(template)}
          className="text-rose-500 focus:text-rose-500"
        >
          <Trash2 className="size-3.5 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function createTemplateColumns({
  categories,
  chartTemplateManagementAvailable,
  onEdit,
  onClone,
  onToggleActive,
  onDelete,
}) {
  return [
    {
      key: "name",
      header: "Template",
      width: "280px",
      render: (template) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{template.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {template.description || "No description"}
          </p>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      width: "160px",
      render: (template) => (
        <Badge variant="outline" className="text-xs">
          {categories.find((cat) => cat.value === template.category)?.label || template.category || "General"}
        </Badge>
      ),
    },
    {
      key: "scope",
      header: "Scope",
      width: "140px",
      render: (template) => (
        <span className="font-mono text-sm text-muted-foreground">
          {template.scope_type_display || template.scope_type || "Patient"}
        </span>
      ),
    },
    {
      key: "visibility",
      header: "Visibility",
      width: "140px",
      render: (template) => (
        <span className="font-mono text-sm text-muted-foreground capitalize">
          {template.visibility || "private"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "120px",
      render: (template) => (
        <Badge
          variant="outline"
          className={template.is_active
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 text-xs"
            : "text-xs"
          }
        >
          {template.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "88px",
      render: (template) => (
        <ChartTemplateActionsMenu
          template={template}
          onEdit={onEdit}
          onClone={onClone}
          onToggleActive={onToggleActive}
          onDelete={onDelete}
        />
      ),
    },
  ].filter((column) => chartTemplateManagementAvailable || column.key !== "actions");
}

function ChartTemplatesContent({
  isLoading,
  filteredTemplates,
  templateColumns,
  hasActiveFilters,
  onCreate,
  onEdit,
}) {
  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-center py-16">
          <LoadingSpinner className="size-8 text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (filteredTemplates.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="text-center py-16">
          <ClipboardList className="size-16 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h2 className="font-display text-xl text-foreground mb-2">
            {hasActiveFilters ? "No templates found" : "No chart templates yet"}
          </h2>
          <p className="font-mono text-sm text-muted-foreground mb-6">
            {hasActiveFilters
              ? "Try adjusting your search or filters"
              : "Create your first chart template to get started"}
          </p>
          {!hasActiveFilters && (
            <Button
              onClick={onCreate}
              className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
              data-onboarding="chart-template-create"
            >
              <Plus className="size-4 mr-1.5" />
              Create Template
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <p className="font-mono text-xs text-muted-foreground">
          {filteredTemplates.length} template
          {filteredTemplates.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="overflow-x-auto">
        <VirtualizedTable
          rows={filteredTemplates}
          rowKey={(template) => template.id}
          rowHeight={68}
          columns={templateColumns}
          onRowClick={(template) => onEdit(template)}
          rowClassName="hover:bg-muted/30"
          className="min-w-[860px]"
          headerClassName="bg-muted/50 border-b border-border"
        />
      </div>
    </div>
  );
}

function DeleteTemplateDialog({
  deleteTarget,
  isDeleting,
  onCancel,
  onConfirm,
}) {
  return (
    <AlertDialog open={!!deleteTarget} onOpenChange={onCancel}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">
            Delete Template
          </AlertDialogTitle>
          <AlertDialogDescription className="font-mono text-sm">
            Are you sure you want to delete "{deleteTarget?.name}"? This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="font-mono text-xs">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="font-mono text-xs bg-rose-500 hover:bg-rose-600"
          >
            {isDeleting ? (
              <LoadingSpinner className="size-3.5" />
            ) : (
              "Delete"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const ChartTemplateListPage = () => {
  const navigate = useNavigate();
  const chartTemplateManagementAvailable = !isRustV2ApiMode();

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");

  // Fetch data
  const { data: templatesData, isLoading } = useChartTemplates({
    category: categoryFilter || undefined,
    visibility: visibilityFilter || undefined,
    is_active: activeFilter === "" ? undefined : activeFilter === "active",
    enabled: chartTemplateManagementAvailable,
  });
  const { data: categories = [] } = useChartCategories({
    enabled: chartTemplateManagementAvailable,
  });

  // Mutations
  const deleteMutation = useDeleteChartTemplate();
  const cloneMutation = useCloneChartTemplate();
  const updateMutation = useUpdateChartTemplate();

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Filter templates by search
  const templates = useMemo(() => templatesData?.results || templatesData || [], [templatesData]);
  const filteredTemplates = useMemo(() => {
    if (!searchQuery) return templates;
    const query = searchQuery.toLowerCase();
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.description?.toLowerCase().includes(query)
    );
  }, [templates, searchQuery]);

  // Handle actions
  const handleCreate = () => {
    if (!chartTemplateManagementAvailable) {
      toast.error("Chart template management is not available in Rust V2 mode yet.");
      return;
    }

    navigate("/charts/builder");
  };

  const handleEdit = useCallback((template) => {
    if (!chartTemplateManagementAvailable) {
      toast.error("Chart template management is not available in Rust V2 mode yet.");
      return;
    }

    navigate(`/charts/builder/${template.id}`);
  }, [chartTemplateManagementAvailable, navigate]);

  const handleClone = useCallback(async (template) => {
    if (!chartTemplateManagementAvailable) {
      toast.error("Chart template management is not available in Rust V2 mode yet.");
      return;
    }

    try {
      const result = await cloneMutation.mutateAsync(template.id);
      toast.success(`Created copy: ${result.name}`);
      navigate(`/charts/builder/${result.id}`);
    } catch (err) {
      console.error("Failed to clone template:", err);
    }
  }, [chartTemplateManagementAvailable, cloneMutation, navigate]);

  const handleToggleActive = useCallback(async (template) => {
    if (!chartTemplateManagementAvailable) {
      toast.error("Chart template management is not available in Rust V2 mode yet.");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        templateId: template.id,
        data: {
          is_active: !template.is_active,
        },
      });
      toast.success(
        template.is_active ? "Template deactivated" : "Template activated"
      );
    } catch (err) {
      console.error("Failed to update template:", err);
    }
  }, [chartTemplateManagementAvailable, updateMutation]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (!chartTemplateManagementAvailable) {
      toast.error("Chart template management is not available in Rust V2 mode yet.");
      setDeleteTarget(null);
      return;
    }

    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success("Template deleted");
      setDeleteTarget(null);
    } catch (err) {
      console.error("Failed to delete template:", err);
    }
  };

  const handleCategoryChange = (value) => setCategoryFilter(value === "all" ? "" : value);
  const handleVisibilityChange = (value) => setVisibilityFilter(value === "all" ? "" : value);
  const handleActiveChange = (value) => setActiveFilter(value === "all" ? "" : value);
  const handleClearFilters = () => {
    setCategoryFilter("");
    setVisibilityFilter("");
    setActiveFilter("");
    setSearchQuery("");
  };

  const templateColumns = useMemo(() => createTemplateColumns({
    categories,
    chartTemplateManagementAvailable,
    onEdit: handleEdit,
    onClone: handleClone,
    onToggleActive: handleToggleActive,
    onDelete: setDeleteTarget,
  }), [
    categories,
    chartTemplateManagementAvailable,
    handleClone,
    handleEdit,
    handleToggleActive,
  ]);

  if (!chartTemplateManagementAvailable) {
    return <ChartTemplateUnavailableState />;
  }

  const hasActiveFilters = searchQuery || categoryFilter || visibilityFilter || activeFilter;

  return (
    <PageShell>
      <ChartTemplatesHeader
        onCreate={handleCreate}
        showCreateAction={true}
      />

      <ChartTemplateFilters
        searchQuery={searchQuery}
        categoryFilter={categoryFilter}
        visibilityFilter={visibilityFilter}
        activeFilter={activeFilter}
        categories={categories}
        onSearchChange={setSearchQuery}
        onCategoryChange={handleCategoryChange}
        onVisibilityChange={handleVisibilityChange}
        onActiveChange={handleActiveChange}
        onClearFilters={handleClearFilters}
      />

      <ChartTemplatesContent
        isLoading={isLoading}
        filteredTemplates={filteredTemplates}
        templateColumns={templateColumns}
        hasActiveFilters={hasActiveFilters}
        onCreate={handleCreate}
        onEdit={handleEdit}
      />

      <DeleteTemplateDialog
        deleteTarget={deleteTarget}
        isDeleting={deleteMutation.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </PageShell>
  );
};

export default ChartTemplateListPage;
