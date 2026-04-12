import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import VirtualizedTable from '@/components/ui/VirtualizedTable';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { LabTestCustomizeSlideOver } from "@/components/laboratory/LabTestCustomizeSlideOver";
import { AddLabTestSlideOver } from "@/components/laboratory/AddLabTestSlideOver";
import {
  useLabTests,
  useLabPanels,
  useDeleteLabTest,
  useDeleteLabPanel,
} from "@/features/laboratory/hooks";
import { toast } from "sonner";
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
import { useSlideOver } from "@/hooks/useSlideOver";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * LabCatalogPage - Chronicle-styled lab test catalog management page
 *
 * Features:
 * - Tabbed interface for tests and panels
 * - Search and filter functionality
 * - Grid/list view toggle
 * - Customize/reset/delete actions
 * - Chronicle design system styling
 */
const LabCatalogPage = () => {
  // Tab state
  const [activeTab, setActiveTab] = useState("tests");

  // Search and filters
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Customize SlideOver state
  const [slideOverOpen, openSlideOver, closeSlideOver] = useSlideOver();
  const [selectedItem, setSelectedItem] = useState(null);
  const [itemType, setItemType] = useState("test");

  // Add SlideOver state
  const [addSlideOverOpen, openAddSlideOver, closeAddSlideOver] = useSlideOver();
  const [addItemType, setAddItemType] = useState("test");

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);

  // Data fetching
  const {
    data: testsData,
    isLoading: testsLoading,
    refetch: refetchTests,
  } = useLabTests({ include_inactive: true });
  const {
    data: panelsData,
    isLoading: panelsLoading,
    refetch: refetchPanels,
  } = useLabPanels({ include_inactive: true });

  // Delete mutations
  const deleteTestMutation = useDeleteLabTest();
  const deletePanelMutation = useDeleteLabPanel();

  // Categories for filter
  const categories = [
    { value: "all", label: "All Categories" },
    { value: "hematology", label: "Hematology" },
    { value: "chemistry", label: "Chemistry" },
    { value: "microbiology", label: "Microbiology" },
    { value: "immunology", label: "Immunology" },
    { value: "urinalysis", label: "Urinalysis" },
    { value: "coagulation", label: "Coagulation" },
    { value: "serology", label: "Serology" },
    { value: "molecular", label: "Molecular/PCR" },
    { value: "pathology", label: "Pathology" },
    { value: "toxicology", label: "Toxicology" },
    { value: "endocrine", label: "Endocrine" },
    { value: "cardiac", label: "Cardiac Markers" },
    { value: "other", label: "Other" },
  ];

  // Status filter options
  const statusOptions = [
    { value: "all", label: "All Status" },
    { value: "system", label: "System Default" },
    { value: "modified", label: "Facility Modified" },
    { value: "custom", label: "Custom" },
    { value: "active", label: "Active Only" },
    { value: "inactive", label: "Inactive Only" },
  ];

  // Filter tests
  const filteredTests = useMemo(() => {
    let tests = testsData || [];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      tests = tests.filter(
        (test) =>
          test.name?.toLowerCase().includes(query) ||
          test.loinc_code?.toLowerCase().includes(query) ||
          test.description?.toLowerCase().includes(query)
      );
    }

    // Category filter
    if (categoryFilter !== "all") {
      tests = tests.filter((test) => test.category === categoryFilter);
    }

    // Status filter
    if (statusFilter !== "all") {
      switch (statusFilter) {
        case "system":
          tests = tests.filter(
            (t) => t.is_system_default && !t.is_facility_modified
          );
          break;
        case "modified":
          tests = tests.filter(
            (t) => t.is_system_default && t.is_facility_modified
          );
          break;
        case "custom":
          tests = tests.filter((t) => !t.is_system_default);
          break;
        case "active":
          tests = tests.filter((t) => t.is_active !== false);
          break;
        case "inactive":
          tests = tests.filter((t) => t.is_active === false);
          break;
      }
    }

    return tests;
  }, [testsData, searchQuery, categoryFilter, statusFilter]);

  // Filter panels
  const filteredPanels = useMemo(() => {
    let panels = panelsData || [];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      panels = panels.filter(
        (panel) =>
          panel.name?.toLowerCase().includes(query) ||
          panel.code?.toLowerCase().includes(query) ||
          panel.description?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (statusFilter !== "all") {
      switch (statusFilter) {
        case "system":
          panels = panels.filter(
            (p) => p.is_system_default && !p.is_facility_modified
          );
          break;
        case "modified":
          panels = panels.filter(
            (p) => p.is_system_default && p.is_facility_modified
          );
          break;
        case "custom":
          panels = panels.filter((p) => !p.is_system_default);
          break;
        case "active":
          panels = panels.filter((p) => p.is_active !== false);
          break;
        case "inactive":
          panels = panels.filter((p) => p.is_active === false);
          break;
      }
    }

    return panels;
  }, [panelsData, searchQuery, statusFilter]);

  // Handle customize
  const handleCustomize = (item, type) => {
    setSelectedItem(item);
    setItemType(type);
    openSlideOver();
  };

  // Handle reset
  const handleReset = (item, type) => {
    setSelectedItem(item);
    setItemType(type);
    openSlideOver();
  };

  // Handle delete initiation
  const handleDeleteInit = (item, type) => {
    setItemToDelete({ ...item, type });
    setDeleteDialogOpen(true);
  };

  // Handle delete confirm
  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;

    try {
      if (itemToDelete.type === "panel") {
        await deletePanelMutation.mutateAsync(itemToDelete.id);
      } else {
        await deleteTestMutation.mutateAsync(itemToDelete.id);
      }
      toast.success(
        `${itemToDelete.type === "panel" ? "Panel" : "Test"} deleted successfully`
      );
    } catch (err) {
      console.error("Delete failed:", err);
      toast.error(err.message || "Failed to delete");
    } finally {
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    }
  };

  // Handle slide over success
  const handleSlideOverSuccess = () => {
    if (itemType === "panel") {
      refetchPanels();
    } else {
      refetchTests();
    }
  };

  // Clear filters
  const clearFilters = () => {
    setSearchQuery("");
    setCategoryFilter("all");
    setStatusFilter("all");
  };

  const hasActiveFilters =
    searchQuery || categoryFilter !== "all" || statusFilter !== "all";

  const formatPrice = (price) => {
    if (!price) return "Not set";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(price);
  };

  const getStatusBadge = (item) => {
    if (!item.is_system_default) {
      return {
        label: "Custom",
        className: "border-sky-500/30 bg-sky-500/10 text-sky-600",
      };
    }
    if (item.is_facility_modified) {
      return {
        label: "Modified",
        className: "border-amber-500/30 bg-amber-500/10 text-amber-600",
      };
    }
    return {
      label: "System",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
    };
  };

  const testsColumns = useMemo(() => ([
    {
      key: "name",
      header: "Test",
      width: "260px",
      render: (test) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{test.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {test.description || "No description"}
          </p>
        </div>
      ),
    },
    {
      key: "code",
      header: "Code",
      width: "140px",
      render: (test) => (
        <span className="font-mono text-sm text-muted-foreground">
          {test.loinc_code || "—"}
        </span>
      ),
    },
    {
      key: "category",
      header: "Category",
      width: "150px",
      render: (test) => (
        <Badge variant="outline" className="text-xs">
          {categories.find((cat) => cat.value === test.category)?.label || test.category || "Other"}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "140px",
      render: (test) => {
        const badge = getStatusBadge(test);
        return (
          <Badge variant="outline" className={cn("text-xs", badge.className)}>
            {badge.label}
          </Badge>
        );
      },
    },
    {
      key: "price",
      header: "Price",
      width: "120px",
      render: (test) => (
        <span className="font-mono text-sm text-muted-foreground">{formatPrice(test.price)}</span>
      ),
    },
    {
      key: "tat",
      header: "TAT",
      width: "120px",
      render: (test) => (
        <span className="font-mono text-sm text-muted-foreground">
          {test.tat_hours ? `${test.tat_hours}h` : "—"}
        </span>
      ),
    },
    {
      key: "specimen",
      header: "Specimen",
      width: "140px",
      render: (test) => (
        <span className="font-mono text-xs uppercase text-muted-foreground">
          {test.specimen_type || "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "180px",
      render: (test) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              handleCustomize(test, "test");
            }}
          >
            Edit
          </Button>
          {test.is_system_default && test.is_facility_modified && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={(event) => {
                event.stopPropagation();
                handleReset(test, "test");
              }}
            >
              Reset
            </Button>
          )}
          {!test.is_system_default && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-destructive"
              onClick={(event) => {
                event.stopPropagation();
                handleDeleteInit(test, "test");
              }}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ]), [categories]);

  const panelsColumns = useMemo(() => ([
    {
      key: "name",
      header: "Panel",
      width: "260px",
      render: (panel) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{panel.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {panel.description || "No description"}
          </p>
        </div>
      ),
    },
    {
      key: "code",
      header: "Code",
      width: "140px",
      render: (panel) => (
        <span className="font-mono text-sm text-muted-foreground">
          {panel.code || "—"}
        </span>
      ),
    },
    {
      key: "tests",
      header: "Tests",
      width: "120px",
      render: (panel) => (
        <span className="font-mono text-sm text-muted-foreground">
          {panel.tests?.length || panel.tests_count || 0}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "140px",
      render: (panel) => {
        const badge = getStatusBadge(panel);
        return (
          <Badge variant="outline" className={cn("text-xs", badge.className)}>
            {badge.label}
          </Badge>
        );
      },
    },
    {
      key: "price",
      header: "Price",
      width: "120px",
      render: (panel) => (
        <span className="font-mono text-sm text-muted-foreground">{formatPrice(panel.price)}</span>
      ),
    },
    {
      key: "state",
      header: "State",
      width: "120px",
      render: (panel) => (
        <Badge variant="outline" className="text-xs">
          {panel.is_active === false ? "Inactive" : "Active"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "180px",
      render: (panel) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              handleCustomize(panel, "panel");
            }}
          >
            Edit
          </Button>
          {panel.is_system_default && panel.is_facility_modified && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={(event) => {
                event.stopPropagation();
                handleReset(panel, "panel");
              }}
            >
              Reset
            </Button>
          )}
          {!panel.is_system_default && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-destructive"
              onClick={(event) => {
                event.stopPropagation();
                handleDeleteInit(panel, "panel");
              }}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ]), []);

  // Loading skeleton
  const LoadingSkeleton = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="p-5 rounded-xl border border-border/50 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="pt-3 border-t border-border/50 grid grid-cols-2 gap-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-16" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        title="Lab Catalog"
        description="Manage laboratory tests and panels for your facility"
        actions={(
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                activeTab === "tests" ? refetchTests() : refetchPanels()
              }
              className="font-mono text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>
            <Button
              size="sm"
              className="font-mono text-xs"
              onClick={() => {
                setAddItemType(activeTab === "tests" ? "test" : "panel");
                openAddSlideOver();
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add {activeTab === "tests" ? "Test" : "Panel"}
            </Button>
          </div>
        )}
      />

      <div className="p-4 sm:p-6 space-y-6">

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-card/30 rounded-xl border border-border/50">
          <div className="flex items-center gap-2 mb-1">
            <TestTube2 className="h-4 w-4 text-sky-600" />
            <span className="font-mono text-xs text-muted-foreground uppercase">
              Tests
            </span>
          </div>
          <span className="font-display text-2xl text-foreground">
            {testsLoading ? "—" : testsData?.length || 0}
          </span>
        </div>
        <div className="p-4 bg-card/30 rounded-xl border border-border/50">
          <div className="flex items-center gap-2 mb-1">
            <FlaskConical className="h-4 w-4 text-amber-600" />
            <span className="font-mono text-xs text-muted-foreground uppercase">
              Panels
            </span>
          </div>
          <span className="font-display text-2xl text-foreground">
            {panelsLoading ? "—" : panelsData?.length || 0}
          </span>
        </div>
        <div className="p-4 bg-card/30 rounded-xl border border-border/50">
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="font-mono text-xs text-muted-foreground uppercase">
              Modified
            </span>
          </div>
          <span className="font-display text-2xl text-foreground">
            {testsLoading
              ? "—"
              : (testsData?.filter((t) => t.is_facility_modified)?.length || 0) +
                (panelsData?.filter((p) => p.is_facility_modified)?.length || 0)}
          </span>
        </div>
        <div className="p-4 bg-card/30 rounded-xl border border-border/50">
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-sky-500" />
            <span className="font-mono text-xs text-muted-foreground uppercase">
              Custom
            </span>
          </div>
          <span className="font-display text-2xl text-foreground">
            {testsLoading
              ? "—"
              : (testsData?.filter((t) => !t.is_system_default)?.length || 0) +
                (panelsData?.filter((p) => !p.is_system_default)?.length || 0)}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="tests" className="font-mono text-xs">
              <TestTube2 className="h-3.5 w-3.5 mr-1.5" />
              Tests
            </TabsTrigger>
            <TabsTrigger value="panels" className="font-mono text-xs">
              <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
              Panels
            </TabsTrigger>
          </TabsList>

        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, code, or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 font-mono text-sm"
            />
          </div>

          {activeTab === "tests" && (
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-[180px] font-mono text-sm">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[160px] font-mono text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="font-mono text-xs"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {/* Tests content */}
        <TabsContent value="tests" className="mt-4">
          {testsLoading ? (
            <LoadingSkeleton />
          ) : filteredTests.length === 0 ? (
            <div className="text-center py-12">
              <TestTube2 className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
              <h3 className="font-display text-lg text-muted-foreground">
                No tests found
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {hasActiveFilters
                  ? "Try adjusting your filters"
                  : "Add your first lab test to get started"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <VirtualizedTable
                rows={filteredTests}
                rowKey={(test) => test.id}
                rowHeight={68}
                columns={testsColumns}
                onRowClick={(test) => handleCustomize(test, "test")}
                rowClassName="hover:bg-muted/30"
                className="min-w-[1260px]"
                headerClassName="bg-muted/50 border-b border-border"
              />
            </div>
          )}
        </TabsContent>

        {/* Panels content */}
        <TabsContent value="panels" className="mt-4">
          {panelsLoading ? (
            <LoadingSkeleton />
          ) : filteredPanels.length === 0 ? (
            <div className="text-center py-12">
              <FlaskConical className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
              <h3 className="font-display text-lg text-muted-foreground">
                No panels found
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {hasActiveFilters
                  ? "Try adjusting your filters"
                  : "Add your first lab panel to get started"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <VirtualizedTable
                rows={filteredPanels}
                rowKey={(panel) => panel.id}
                rowHeight={68}
                columns={panelsColumns}
                onRowClick={(panel) => handleCustomize(panel, "panel")}
                rowClassName="hover:bg-muted/30"
                className="min-w-[1180px]"
                headerClassName="bg-muted/50 border-b border-border"
              />
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Customize slide-over */}
      <LabTestCustomizeSlideOver
        open={slideOverOpen}
        onClose={closeSlideOver}
        item={selectedItem}
        type={itemType}
        onSuccess={handleSlideOverSuccess}
      />

      {/* Add slide-over */}
      <AddLabTestSlideOver
        open={addSlideOverOpen}
        onClose={closeAddSlideOver}
        type={addItemType}
        onSuccess={() => {
          if (addItemType === "panel") {
            refetchPanels();
          } else {
            refetchTests();
          }
        }}
      />

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {itemToDelete?.type === "panel" ? "Panel" : "Test"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{itemToDelete?.name}"? This action
              cannot be undone.
              {itemToDelete?.is_system_default && (
                <span className="block mt-2 text-amber-600">
                  Note: System default items cannot be deleted.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono text-xs"
              disabled={
                deleteTestMutation.isPending || deletePanelMutation.isPending
              }
            >
              {deleteTestMutation.isPending || deletePanelMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </PageShell>
  );
};

export default LabCatalogPage;
