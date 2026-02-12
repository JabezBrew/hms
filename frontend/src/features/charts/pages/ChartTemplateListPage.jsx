/**
 * ChartTemplateListPage - Browse and manage chart templates
 *
 * Chronicle-styled page for viewing all available chart templates
 * with search, filtering, and management actions.
 */

import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import MoreVertical from 'lucide-react/dist/esm/icons/ellipsis-vertical.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import Copy from 'lucide-react/dist/esm/icons/copy.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { ChartTemplateCard } from "@/components/charts";
import {
  useChartTemplates,
  useChartCategories,
  useDeleteChartTemplate,
  useCloneChartTemplate,
  useUpdateChartTemplate,
} from "@/features/charts/hooks";
import { PageHeader } from "@/shared/components/page/PageHeader";
import { PageShell } from "@/shared/components/page/PageShell";

const ChartTemplateListPage = () => {
  const navigate = useNavigate();

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
  });
  const { data: categories = [] } = useChartCategories();

  // Mutations
  const deleteMutation = useDeleteChartTemplate();
  const cloneMutation = useCloneChartTemplate();
  const updateMutation = useUpdateChartTemplate();

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Filter templates by search
  const templates = templatesData?.results || templatesData || [];
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
    navigate("/charts/builder");
  };

  const handleEdit = (template) => {
    navigate(`/charts/builder/${template.id}`);
  };

  const handleClone = async (template) => {
    try {
      const result = await cloneMutation.mutateAsync(template.id);
      toast.success(`Created copy: ${result.name}`);
      navigate(`/charts/builder/${result.id}`);
    } catch (err) {
      console.error("Failed to clone template:", err);
    }
  };

  const handleToggleActive = async (template) => {
    try {
      await updateMutation.mutateAsync({
        id: template.id,
        is_active: !template.is_active,
      });
      toast.success(
        template.is_active ? "Template deactivated" : "Template activated"
      );
    } catch (err) {
      console.error("Failed to update template:", err);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success("Template deleted");
      setDeleteTarget(null);
    } catch (err) {
      console.error("Failed to delete template:", err);
    }
  };

  // Template card with actions
  const renderTemplateCard = (template, index) => (
    <div key={template.id} className="relative group">
      <ChartTemplateCard
        template={template}
        index={index}
        onSelect={handleEdit}
        showActions={false}
      />
      {/* Actions dropdown */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0 bg-card">
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[200]">
            <DropdownMenuItem onClick={() => handleEdit(template)}>
              <Pencil className="h-3.5 w-3.5 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleClone(template)}>
              <Copy className="h-3.5 w-3.5 mr-2" />
              Clone
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleToggleActive(template)}>
              {template.is_active ? (
                <>
                  <EyeOff className="h-3.5 w-3.5 mr-2" />
                  Deactivate
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5 mr-2" />
                  Activate
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setDeleteTarget(template)}
              className="text-rose-500 focus:text-rose-500"
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        title={(
          <span className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/30">
              <ClipboardList className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </span>
            Chart Templates
          </span>
        )}
        description="Create and manage clinical monitoring charts"
        descriptionClassName="font-mono text-xs text-muted-foreground"
        actions={(
          <Button
            onClick={handleCreate}
            className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
            data-onboarding="chart-template-create"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Template
          </Button>
        )}
        contentClassName="max-w-7xl mx-auto w-full"
      />

      {/* Filters */}
      <div className="border-b border-border bg-muted/30">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 font-mono"
              />
            </div>

            <Select value={categoryFilter || "all"} onValueChange={(v) => setCategoryFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[160px] font-mono">
                <Filter className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
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

            <Select value={visibilityFilter || "all"} onValueChange={(v) => setVisibilityFilter(v === "all" ? "" : v)}>
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

            <Select value={activeFilter || "all"} onValueChange={(v) => setActiveFilter(v === "all" ? "" : v)}>
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

            {(categoryFilter || visibilityFilter || activeFilter || searchQuery) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCategoryFilter("");
                  setVisibilityFilter("");
                  setActiveFilter("");
                  setSearchQuery("");
                }}
                className="font-mono text-xs text-muted-foreground"
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="text-center py-16">
            <ClipboardList className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h2 className="font-display text-xl text-foreground mb-2">
              {searchQuery || categoryFilter || visibilityFilter || activeFilter
                ? "No templates found"
                : "No chart templates yet"}
            </h2>
            <p className="font-mono text-sm text-muted-foreground mb-6">
              {searchQuery || categoryFilter || visibilityFilter || activeFilter
                ? "Try adjusting your search or filters"
                : "Create your first chart template to get started"}
            </p>
            {!searchQuery && !categoryFilter && !visibilityFilter && !activeFilter && (
              <Button
                onClick={handleCreate}
                className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
                data-onboarding="chart-template-create"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Create Template
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <p className="font-mono text-xs text-muted-foreground">
                {filteredTemplates.length} template
                {filteredTemplates.length !== 1 ? "s" : ""}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTemplates.map((template, index) =>
                renderTemplateCard(template, index)
              )}
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
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
              onClick={handleDelete}
              className="font-mono text-xs bg-rose-500 hover:bg-rose-600"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
};

export default ChartTemplateListPage;
