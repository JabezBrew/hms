/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
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
import { useRouteTableState } from '@/shared/hooks/useRouteTableState';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

const USD_CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

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

function formatCatalogPrice(price) {
  if (!price) return "Not set";
  return USD_CURRENCY_FORMATTER.format(price);
}

function getCatalogStatusBadge(item) {
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
}

function createTestsColumns({
  catalogMutationsAvailable,
  customizeCatalogItem,
  deleteCatalogItem,
  resetCatalogItem,
}) {
  return [
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
        const badge = getCatalogStatusBadge(test);
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
        <span className="font-mono text-sm text-muted-foreground">{formatCatalogPrice(test.price)}</span>
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
        <CatalogRowActions
          item={test}
          type="test"
          onCustomize={customizeCatalogItem}
          onDelete={deleteCatalogItem}
          onReset={resetCatalogItem}
        />
      ),
    },
  ].filter((column) => catalogMutationsAvailable || column.key !== "actions");
}

function createPanelsColumns({
  catalogMutationsAvailable,
  customizeCatalogItem,
  deleteCatalogItem,
  resetCatalogItem,
}) {
  return [
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
        const badge = getCatalogStatusBadge(panel);
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
        <span className="font-mono text-sm text-muted-foreground">{formatCatalogPrice(panel.price)}</span>
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
        <CatalogRowActions
          item={panel}
          type="panel"
          onCustomize={customizeCatalogItem}
          onDelete={deleteCatalogItem}
          onReset={resetCatalogItem}
        />
      ),
    },
  ].filter((column) => catalogMutationsAvailable || column.key !== "actions");
}

function CatalogRowActions({ item, onCustomize, onDelete, onReset, type }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs"
        onClick={(event) => {
          event.stopPropagation();
          onCustomize(item, type);
        }}
      >
        Edit
      </Button>
      {item.is_system_default && item.is_facility_modified ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={(event) => {
            event.stopPropagation();
            onReset(item, type);
          }}
        >
          Reset
        </Button>
      ) : null}
      {!item.is_system_default ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs text-destructive"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(item, type);
          }}
        >
          Delete
        </Button>
      ) : null}
    </div>
  );
}

function LabCatalogView({
  activeCountExact,
  activeHasNextPage,
  activeTab,
  activeTotalCount,
  addItemType,
  addSlideOverOpen,
  catalogMutationsAvailable,
  categoryFilter,
  clearFilters,
  closeAddSlideOver,
  closeSlideOver,
  deleteDialogOpen,
  deletePanelMutation,
  deleteTestMutation,
  handleAddSuccess,
  handleCategoryFilterChange,
  handleDeleteConfirm,
  handleRefresh,
  handleSearchChange,
  handleStatusFilterChange,
  handleTabChange,
  hasActiveFilters,
  isActiveFetching,
  itemToDelete,
  itemType,
  metrics,
  openAddCatalogItem,
  page,
  panels,
  panelsColumns,
  panelsLoading,
  searchQuery,
  selectedItem,
  setDeleteDialogOpen,
  setPage,
  slideOverOpen,
  statusFilter,
  tests,
  testsColumns,
  testsLoading,
  customizeCatalogItem,
  handleSlideOverSuccess,
}) {
  return (
    <PageShell>
      <LabCatalogHeader
        activeTab={activeTab}
        catalogMutationsAvailable={catalogMutationsAvailable}
        isActiveFetching={isActiveFetching}
        metrics={metrics}
        onAdd={openAddCatalogItem}
        onRefresh={handleRefresh}
      />

      {!catalogMutationsAvailable ? <LabCatalogReadonlyAlert /> : null}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <LabCatalogTabs />
        <LabCatalogFilters
          activeTab={activeTab}
          categoryFilter={categoryFilter}
          clearFilters={clearFilters}
          handleCategoryFilterChange={handleCategoryFilterChange}
          handleSearchChange={handleSearchChange}
          handleStatusFilterChange={handleStatusFilterChange}
          hasActiveFilters={hasActiveFilters}
          searchQuery={searchQuery}
          statusFilter={statusFilter}
        />

        <main className="p-4 sm:p-6">
          <CatalogTableTab
            activeTab="tests"
            catalogMutationsAvailable={catalogMutationsAvailable}
            columns={testsColumns}
            emptyIcon={TestTube2}
            emptyTitle="No tests found"
            hasActiveFilters={hasActiveFilters}
            isLoading={testsLoading}
            itemLabel="test"
            minWidthClass="min-w-[1260px]"
            onClearFilters={clearFilters}
            onCreate={() => openAddCatalogItem("test")}
            onRowCustomize={customizeCatalogItem}
            rows={tests}
          />

          <CatalogTableTab
            activeTab="panels"
            catalogMutationsAvailable={catalogMutationsAvailable}
            columns={panelsColumns}
            emptyIcon={FlaskConical}
            emptyTitle="No panels found"
            hasActiveFilters={hasActiveFilters}
            isLoading={panelsLoading}
            itemLabel="panel"
            minWidthClass="min-w-[1180px]"
            onClearFilters={clearFilters}
            onCreate={() => openAddCatalogItem("panel")}
            onRowCustomize={customizeCatalogItem}
            rows={panels}
          />

          {activeTotalCount > CATALOG_PAGE_SIZE || activeHasNextPage ? (
            <div className="pt-4">
              <TablePagination
                currentPage={page}
                totalCount={activeTotalCount}
                pageSize={CATALOG_PAGE_SIZE}
                onPageChange={setPage}
                countExact={activeCountExact}
                hasNextPage={activeHasNextPage}
                hasPrevPage={page > 1}
                itemLabel={activeTab === "tests" ? "tests" : "panels"}
              />
            </div>
          ) : null}
        </main>
      </Tabs>

      {catalogMutationsAvailable ? (
        <LabCatalogSlideOvers
          addItemType={addItemType}
          addSlideOverOpen={addSlideOverOpen}
          closeAddSlideOver={closeAddSlideOver}
          closeSlideOver={closeSlideOver}
          handleAddSuccess={handleAddSuccess}
          handleSlideOverSuccess={handleSlideOverSuccess}
          itemType={itemType}
          selectedItem={selectedItem}
          slideOverOpen={slideOverOpen}
        />
      ) : null}

      <LabCatalogDeleteDialog
        deleteDialogOpen={deleteDialogOpen}
        deletePanelMutation={deletePanelMutation}
        deleteTestMutation={deleteTestMutation}
        handleDeleteConfirm={handleDeleteConfirm}
        itemToDelete={itemToDelete}
        setDeleteDialogOpen={setDeleteDialogOpen}
      />
    </PageShell>
  );
}

function LabCatalogHeader({
  activeTab,
  catalogMutationsAvailable,
  isActiveFetching,
  metrics,
  onAdd,
  onRefresh,
}) {
  return (
    <PageHeader
      title="Lab Catalog"
      description="Manage laboratory tests and panels for your facility"
      actions={(
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isActiveFetching}
            className="font-mono text-xs"
          >
            {isActiveFetching ? (
              <LoadingSpinner className="mr-1.5 h-3.5 w-7" />
            ) : (
              <RefreshCw className="size-3.5 mr-1.5" />
            )}
            Refresh
          </Button>
          {catalogMutationsAvailable ? (
            <Button
              size="sm"
              className="font-mono text-xs"
              onClick={() => onAdd(activeTab === "tests" ? "test" : "panel")}
            >
              <Plus className="size-3.5 mr-1.5" />
              Add {activeTab === "tests" ? "Test" : "Panel"}
            </Button>
          ) : null}
        </div>
      )}
    >
      <LabMetricGrid metrics={metrics} className="mt-4 sm:mt-6" />
    </PageHeader>
  );
}

function LabCatalogReadonlyAlert() {
  return (
    <div className="px-4 pt-4 sm:px-6">
      <Alert>
        <TestTube2 className="size-4" />
        <AlertDescription>
          Lab catalog editing is not available in Rust V2 mode yet. Existing tests and panels remain available for ordering.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function LabCatalogTabs() {
  return (
    <LabToolbar className="py-3">
      <TabsList className="h-auto bg-muted/50 p-1">
        <TabsTrigger value="tests" className="font-mono text-xs">
          <TestTube2 className="size-3.5 mr-1.5" />
          Tests
        </TabsTrigger>
        <TabsTrigger value="panels" className="font-mono text-xs">
          <FlaskConical className="size-3.5 mr-1.5" />
          Panels
        </TabsTrigger>
      </TabsList>
    </LabToolbar>
  );
}

function LabCatalogFilters({
  activeTab,
  categoryFilter,
  clearFilters,
  handleCategoryFilterChange,
  handleSearchChange,
  handleStatusFilterChange,
  hasActiveFilters,
  searchQuery,
  statusFilter,
}) {
  return (
    <LabToolbar>
      <div className="flex flex-col gap-3 sm:flex-row">
        <LabSearchField
          id="lab-catalog-search"
          placeholder="Search by name, code, or description..."
          value={searchQuery}
          onChange={handleSearchChange}
        />

        {activeTab === "tests" ? (
          <Select value={categoryFilter} onValueChange={handleCategoryFilterChange}>
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
        ) : null}

        <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
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

        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="font-mono text-xs"
          >
            <X className="size-3.5 mr-1" />
            Clear
          </Button>
        ) : null}
      </div>
    </LabToolbar>
  );
}

function CatalogTableTab({
  activeTab,
  catalogMutationsAvailable,
  columns,
  emptyIcon,
  emptyTitle,
  hasActiveFilters,
  isLoading,
  itemLabel,
  minWidthClass,
  onClearFilters,
  onCreate,
  onRowCustomize,
  rows,
}) {
  const pluralItemLabel = itemLabel === "test" ? "tests" : "panels";

  return (
    <TabsContent value={activeTab} className="m-0">
      {isLoading ? (
        <LabTableSkeleton />
      ) : rows.length === 0 ? (
        <LabEmptyState
          icon={emptyIcon}
          title={emptyTitle}
          description={
            hasActiveFilters
              ? "Try adjusting your filters."
              : `Add your first lab ${itemLabel} to get started.`
          }
          action={hasActiveFilters ? (
            <Button variant="outline" size="sm" onClick={onClearFilters} className="font-mono text-xs">
              Clear Filters
            </Button>
          ) : catalogMutationsAvailable ? (
            <Button
              size="sm"
              onClick={onCreate}
              className="font-mono text-xs"
            >
              <Plus className="mr-1.5 size-3.5" />
              Add {itemLabel === "test" ? "Test" : "Panel"}
            </Button>
          ) : null}
        />
      ) : (
        <div className="overflow-x-auto">
          <VirtualizedTable
            rows={rows}
            rowKey={(item) => item.id}
            rowHeight={68}
            columns={columns}
            onRowClick={catalogMutationsAvailable ? (item) => onRowCustomize(item, itemLabel) : undefined}
            rowClassName="hover:bg-muted/30"
            className={cn(labTableClassName, minWidthClass)}
            headerClassName={labTableHeaderClassName}
            aria-label={`${pluralItemLabel} catalog`}
          />
        </div>
      )}
    </TabsContent>
  );
}

function LabCatalogSlideOvers({
  addItemType,
  addSlideOverOpen,
  closeAddSlideOver,
  closeSlideOver,
  handleAddSuccess,
  handleSlideOverSuccess,
  itemType,
  selectedItem,
  slideOverOpen,
}) {
  return (
    <>
      <LabTestCustomizeSlideOver
        open={slideOverOpen}
        onClose={closeSlideOver}
        item={selectedItem}
        type={itemType}
        onSuccess={handleSlideOverSuccess}
      />

      <AddLabTestSlideOver
        open={addSlideOverOpen}
        onClose={closeAddSlideOver}
        type={addItemType}
        onSuccess={handleAddSuccess}
      />
    </>
  );
}

function LabCatalogDeleteDialog({
  deleteDialogOpen,
  deletePanelMutation,
  deleteTestMutation,
  handleDeleteConfirm,
  itemToDelete,
  setDeleteDialogOpen,
}) {
  const isDeleting = deleteTestMutation.isPending || deletePanelMutation.isPending;

  return (
    <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {itemToDelete?.type === "panel" ? "Panel" : "Test"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{itemToDelete?.name}"? This action
            cannot be undone.
            {itemToDelete?.is_system_default ? (
              <span className="block mt-2 text-amber-600">
                Note: System default items cannot be deleted.
              </span>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="font-mono text-xs">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono text-xs"
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <LoadingSpinner className="size-3.5 mr-1.5" />
                Deleting…
              </>
            ) : (
              "Delete"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function useLabCatalogMetrics({
  customPanelsData,
  customTestsData,
  modifiedPanelsData,
  modifiedTestsData,
  panelsSummaryData,
  panelsSummaryLoading,
  testsSummaryData,
  testsSummaryLoading,
}) {
  return useMemo(() => ([
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
  const catalogMutationsAvailable = !isRustV2ApiMode();
  const [persistedCatalogState, setPersistedCatalogState] = useRouteTableState('laboratory:catalogTable', {
    activeTab: 'tests',
    searchQuery: '',
    categoryFilter: 'all',
    statusFilter: 'all',
    page: 1,
  });

  // Tab state
  const [activeTab, setActiveTab] = useState(persistedCatalogState.activeTab || "tests");

  // Search and filters
  const [searchQuery, setSearchQuery] = useState(persistedCatalogState.searchQuery || "");
  const [categoryFilter, setCategoryFilter] = useState(persistedCatalogState.categoryFilter || "all");
  const [statusFilter, setStatusFilter] = useState(persistedCatalogState.statusFilter || "all");
  const [page, setPage] = useState(persistedCatalogState.page || 1);
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

  const activeData = activeTab === "tests" ? testsData : panelsData;
  const activeTotalCount = activeData?.count || 0;
  const activeCountExact = activeData?.count_exact !== false && activeData?.total_is_lower_bound !== true;
  const activeHasNextPage = Boolean(activeData?.next);
  const resolvedPage = Number(activeData?.page || page);
  const isActiveFetching = activeTab === "tests" ? testsFetching : panelsFetching;

  useEffect(() => {
    if (activeData?.cursor_missing && resolvedPage !== page) {
      setPage(resolvedPage);
      setPersistedCatalogState({ page: resolvedPage });
    }
  }, [activeData?.cursor_missing, page, resolvedPage, setPersistedCatalogState]);

  const metrics = useLabCatalogMetrics({
    customPanelsData,
    customTestsData,
    modifiedPanelsData,
    modifiedTestsData,
    panelsSummaryData,
    panelsSummaryLoading,
    testsSummaryData,
    testsSummaryLoading,
  });

  // Delete mutations
  const deleteTestMutation = useDeleteLabTest();
  const deletePanelMutation = useDeleteLabPanel();

  // Handle customize
  const handleCustomize = (item, type) => {
    if (!catalogMutationsAvailable) {
      toast.error("Lab catalog editing is not available in Rust V2 mode yet.");
      return;
    }

    setSelectedItem(item);
    setItemType(type);
    openSlideOver();
  };

  // Handle reset
  const handleReset = (item, type) => {
    if (!catalogMutationsAvailable) {
      toast.error("Lab catalog editing is not available in Rust V2 mode yet.");
      return;
    }

    setSelectedItem(item);
    setItemType(type);
    openSlideOver();
  };

  // Handle delete initiation
  const handleDeleteInit = (item, type) => {
    if (!catalogMutationsAvailable) {
      toast.error("Lab catalog editing is not available in Rust V2 mode yet.");
      return;
    }

    setItemToDelete({ ...item, type });
    setDeleteDialogOpen(true);
  };

  // Handle delete confirm
  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;
    if (!catalogMutationsAvailable) {
      toast.error("Lab catalog editing is not available in Rust V2 mode yet.");
      setDeleteDialogOpen(false);
      setItemToDelete(null);
      return;
    }

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
  const handleTabChange = (value) => {
    setActiveTab(value);
    setPage(1);
    setPersistedCatalogState({ activeTab: value, page: 1 });
  };

  const handleSearchChange = (event) => {
    const nextSearch = event.target.value;
    setSearchQuery(nextSearch);
    setPage(1);
    setPersistedCatalogState({ searchQuery: nextSearch, page: 1 });
  };

  const handleCategoryFilterChange = (value) => {
    setCategoryFilter(value);
    setPage(1);
    setPersistedCatalogState({ categoryFilter: value, page: 1 });
  };

  const handleStatusFilterChange = (value) => {
    setStatusFilter(value);
    setPage(1);
    setPersistedCatalogState({ statusFilter: value, page: 1 });
  };

  const clearFilters = () => {
    setSearchQuery("");
    setCategoryFilter("all");
    setStatusFilter("all");
    setPage(1);
    setPersistedCatalogState({
      searchQuery: "",
      categoryFilter: "all",
      statusFilter: "all",
      page: 1,
    });
  };

  const handlePageChange = (nextPage) => {
    setPage(nextPage);
    setPersistedCatalogState({ page: nextPage });
  };

  const hasActiveFilters =
    searchQuery.trim() || statusFilter !== "all" || (activeTab === "tests" && categoryFilter !== "all");

  const openAddCatalogItem = (type) => {
    setAddItemType(type);
    openAddSlideOver();
  };

  const handleRefresh = () => {
    if (activeTab === "tests") {
      refetchTests();
    } else {
      refetchPanels();
    }
  };

  const handleAddSuccess = () => {
    if (addItemType === "panel") {
      refetchPanels();
    } else {
      refetchTests();
    }
  };

  const testsColumns = createTestsColumns({
    catalogMutationsAvailable,
    customizeCatalogItem: handleCustomize,
    deleteCatalogItem: handleDeleteInit,
    resetCatalogItem: handleReset,
  });

  const panelsColumns = createPanelsColumns({
    catalogMutationsAvailable,
    customizeCatalogItem: handleCustomize,
    deleteCatalogItem: handleDeleteInit,
    resetCatalogItem: handleReset,
  });

  return (
    <LabCatalogView
      activeCountExact={activeCountExact}
      activeHasNextPage={activeHasNextPage}
      activeTab={activeTab}
      activeTotalCount={activeTotalCount}
      addItemType={addItemType}
      addSlideOverOpen={addSlideOverOpen}
      catalogMutationsAvailable={catalogMutationsAvailable}
      categoryFilter={categoryFilter}
      clearFilters={clearFilters}
      closeAddSlideOver={closeAddSlideOver}
      closeSlideOver={closeSlideOver}
      deleteDialogOpen={deleteDialogOpen}
      deletePanelMutation={deletePanelMutation}
      deleteTestMutation={deleteTestMutation}
      handleAddSuccess={handleAddSuccess}
      handleCategoryFilterChange={handleCategoryFilterChange}
      handleDeleteConfirm={handleDeleteConfirm}
      handleRefresh={handleRefresh}
      handleSearchChange={handleSearchChange}
      handleSlideOverSuccess={handleSlideOverSuccess}
      handleStatusFilterChange={handleStatusFilterChange}
      handleTabChange={handleTabChange}
      hasActiveFilters={hasActiveFilters}
      isActiveFetching={isActiveFetching}
      itemToDelete={itemToDelete}
      itemType={itemType}
      metrics={metrics}
      openAddCatalogItem={openAddCatalogItem}
      page={resolvedPage}
      panels={panels}
      panelsColumns={panelsColumns}
      panelsLoading={panelsLoading}
      searchQuery={searchQuery}
      selectedItem={selectedItem}
      setDeleteDialogOpen={setDeleteDialogOpen}
      setPage={handlePageChange}
      slideOverOpen={slideOverOpen}
      statusFilter={statusFilter}
      tests={tests}
      testsColumns={testsColumns}
      testsLoading={testsLoading}
      customizeCatalogItem={handleCustomize}
    />
  );
};

export default LabCatalogPage;
