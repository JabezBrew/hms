import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useEffect, useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TablePagination } from '@/components/ui/table-pagination';
import VirtualizedTable from '@/components/ui/VirtualizedTable';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import {
  LabEmptyState,
  LabMetricGrid,
  LabSearchField,
  LabTableSkeleton,
  LabToolbar,
  labTableClassName,
  labTableHeaderClassName,
} from '@/features/laboratory/components';
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
import { useDebounce } from '@/hooks/use-debounce';

const CATALOG_PAGE_SIZE = 24;

const CATALOG_CATEGORY_OPTIONS = [
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

const CATALOG_STATUS_OPTIONS = [
  { value: "all", label: "All Status" },
  { value: "system", label: "System Default" },
  { value: "modified", label: "Facility Modified" },
  { value: "custom", label: "Custom" },
  { value: "active", label: "Active Only" },
  { value: "inactive", label: "Inactive Only" },
];

function getStatusQueryParams(statusFilter) {
  switch (statusFilter) {
    case "system":
      return { is_system_default: true, is_facility_modified: false };
    case "modified":
      return { is_system_default: true, is_facility_modified: true };
    case "custom":
      return { is_system_default: false };
    case "active":
      return { is_active: true };
    case "inactive":
      return { is_active: false };
    default:
      return {};
  }
}

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
  const [page, setPage] = useState(1);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

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

  useEffect(() => {
    setPage(1);
  }, [activeTab, debouncedSearchQuery, categoryFilter, statusFilter]);

  const catalogFilters = useMemo(() => {
    const filters = {
      page,
      page_size: CATALOG_PAGE_SIZE,
      ...getStatusQueryParams(statusFilter),
    };

    if (debouncedSearchQuery.trim()) {
      filters.search = debouncedSearchQuery.trim();
    }

    if (activeTab === "tests" && categoryFilter !== "all") {
      filters.category = categoryFilter;
    }

    return filters;
  }, [activeTab, categoryFilter, debouncedSearchQuery, page, statusFilter]);

  // Data fetching
  const {
    data: testsData,
    isLoading: testsLoading,
    isFetching: testsFetching,
    refetch: refetchTests,
  } = useLabTests({ ...catalogFilters, enabled: activeTab === "tests" });
  const {
    data: panelsData,
    isLoading: panelsLoading,
    isFetching: panelsFetching,
    refetch: refetchPanels,
  } = useLabPanels({ ...catalogFilters, enabled: activeTab === "panels" });

  const { data: testsSummaryData, isLoading: testsSummaryLoading } = useLabTests({ page_size: 1 });
  const { data: panelsSummaryData, isLoading: panelsSummaryLoading } = useLabPanels({ page_size: 1 });
  const { data: modifiedTestsData } = useLabTests({ page_size: 1, is_facility_modified: true });
  const { data: modifiedPanelsData } = useLabPanels({ page_size: 1, is_facility_modified: true });
  const { data: customTestsData } = useLabTests({ page_size: 1, is_system_default: false });
  const { data: customPanelsData } = useLabPanels({ page_size: 1, is_system_default: false });

  const tests = useMemo(() => {
    const results = testsData?.results || [];
    return Array.isArray(results) ? results : [];
  }, [testsData]);

  const panels = useMemo(() => {
    const results = panelsData?.results || [];
    return Array.isArray(results) ? results : [];
  }, [panelsData]);

  const activeTotalCount = activeTab === "tests" ? testsData?.count || 0 : panelsData?.count || 0;
  const isActiveFetching = activeTab === "tests" ? testsFetching : panelsFetching;

  const metrics = useMemo(() => ([
    {
      label: "Tests",
      value: testsSummaryLoading ? "—" : testsSummaryData?.count ?? 0,
      icon: TestTube2,
      color: "sky",
    },
    {
      label: "Panels",
      value: panelsSummaryLoading ? "—" : panelsSummaryData?.count ?? 0,
      icon: FlaskConical,
      color: "amber",
    },
    {
      label: "Modified",
      value: (modifiedTestsData?.count ?? 0) + (modifiedPanelsData?.count ?? 0),
      icon: RefreshCw,
      color: "amber",
    },
    {
      label: "Custom",
      value: (customTestsData?.count ?? 0) + (customPanelsData?.count ?? 0),
      icon: Plus,
      color: "sky",
    },
  ]), [
    customPanelsData,
    customTestsData,
    modifiedPanelsData,
    modifiedTestsData,
    panelsSummaryData,
    panelsSummaryLoading,
    testsSummaryData,
    testsSummaryLoading,
  ]);

  // Delete mutations
  const deleteTestMutation = useDeleteLabTest();
  const deletePanelMutation = useDeleteLabPanel();

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
    setPage(1);
  };

  const hasActiveFilters =
    searchQuery.trim() || statusFilter !== "all" || (activeTab === "tests" && categoryFilter !== "all");

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

  const testsColumns = [
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
          {CATALOG_CATEGORY_OPTIONS.find((cat) => cat.value === test.category)?.label || test.category || "Other"}
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
  ];

  const panelsColumns = [
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
          {panel.test_count ?? panel.tests?.length ?? 0}
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
  ];

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
              disabled={isActiveFetching}
              className="font-mono text-xs"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isActiveFetching && "animate-spin")} />
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
      >
        <LabMetricGrid metrics={metrics} className="mt-4 sm:mt-6" />
      </PageHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <LabToolbar className="py-3">
          <TabsList className="h-auto bg-muted/50 p-1">
            <TabsTrigger value="tests" className="font-mono text-xs">
              <TestTube2 className="h-3.5 w-3.5 mr-1.5" />
              Tests
            </TabsTrigger>
            <TabsTrigger value="panels" className="font-mono text-xs">
              <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
              Panels
            </TabsTrigger>
          </TabsList>
        </LabToolbar>

        <LabToolbar>
          <div className="flex flex-col gap-3 sm:flex-row">
            <LabSearchField
              id="lab-catalog-search"
              placeholder="Search by name, code, or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            {activeTab === "tests" && (
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-[180px] font-mono text-sm">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {CATALOG_CATEGORY_OPTIONS.map((cat) => (
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
                {CATALOG_STATUS_OPTIONS.map((opt) => (
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
        </LabToolbar>

        <main className="p-4 sm:p-6">
          <TabsContent value="tests" className="m-0">
            {testsLoading ? (
              <LabTableSkeleton />
            ) : tests.length === 0 ? (
              <LabEmptyState
                icon={TestTube2}
                title="No tests found"
                description={
                  hasActiveFilters
                    ? "Try adjusting your filters."
                    : "Add your first lab test to get started."
                }
                action={hasActiveFilters ? (
                  <Button variant="outline" size="sm" onClick={clearFilters} className="font-mono text-xs">
                    Clear Filters
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      setAddItemType("test");
                      openAddSlideOver();
                    }}
                    className="font-mono text-xs"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add Test
                  </Button>
                )}
              />
            ) : (
              <div className="overflow-x-auto">
                <VirtualizedTable
                  rows={tests}
                  rowKey={(test) => test.id}
                  rowHeight={68}
                  columns={testsColumns}
                  onRowClick={(test) => handleCustomize(test, "test")}
                  rowClassName="hover:bg-muted/30"
                  className={cn(labTableClassName, "min-w-[1260px]")}
                  headerClassName={labTableHeaderClassName}
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="panels" className="m-0">
            {panelsLoading ? (
              <LabTableSkeleton />
            ) : panels.length === 0 ? (
              <LabEmptyState
                icon={FlaskConical}
                title="No panels found"
                description={
                  hasActiveFilters
                    ? "Try adjusting your filters."
                    : "Add your first lab panel to get started."
                }
                action={hasActiveFilters ? (
                  <Button variant="outline" size="sm" onClick={clearFilters} className="font-mono text-xs">
                    Clear Filters
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      setAddItemType("panel");
                      openAddSlideOver();
                    }}
                    className="font-mono text-xs"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add Panel
                  </Button>
                )}
              />
            ) : (
              <div className="overflow-x-auto">
                <VirtualizedTable
                  rows={panels}
                  rowKey={(panel) => panel.id}
                  rowHeight={68}
                  columns={panelsColumns}
                  onRowClick={(panel) => handleCustomize(panel, "panel")}
                  rowClassName="hover:bg-muted/30"
                  className={cn(labTableClassName, "min-w-[1180px]")}
                  headerClassName={labTableHeaderClassName}
                />
              </div>
            )}
          </TabsContent>

          {activeTotalCount > CATALOG_PAGE_SIZE && (
            <div className="pt-4">
              <TablePagination
                currentPage={page}
                totalCount={activeTotalCount}
                pageSize={CATALOG_PAGE_SIZE}
                onPageChange={setPage}
                itemLabel={activeTab === "tests" ? "tests" : "panels"}
              />
            </div>
          )}
        </main>
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
    </PageShell>
  );
};

export default LabCatalogPage;
