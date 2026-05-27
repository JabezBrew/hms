import { EncounterFiltersPanel } from './EncounterFiltersPanel';
import { EncounterListErrorState } from './EncounterListErrorState';
import { EncounterListHeader } from './EncounterListHeader';
import { EncounterPagination } from './EncounterPagination';
import { EncounterTabs } from './EncounterTabs';
import { useEncounterListController } from './useEncounterListController';

export function EncounterList() {
  const controller = useEncounterListController();

  if (controller.isError) {
    return (
      <EncounterListErrorState
        error={controller.error}
        onRetry={() => controller.refetch()}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <EncounterListHeader
        currentPage={controller.currentPage}
        hasActiveFilters={controller.hasActiveFilters}
        onCreateEncounter={() => controller.navigate('/encounters/new')}
        onToggleFilters={() => controller.setShowFilters(!controller.showFilters)}
        totalCount={controller.totalCount}
        totalPages={controller.totalPages}
      />

      <main className="p-6 space-y-6">
        {controller.showFilters && (
          <EncounterFiltersPanel
            activeTab={controller.activeTab}
            filters={controller.filters}
            hasActiveFilters={controller.hasActiveFilters}
            onFilterChange={controller.handleFilterChange}
            onResetFilters={controller.resetFilters}
          />
        )}

        <EncounterTabs
          activeTab={controller.activeTab}
          encounters={controller.encounters}
          isLoading={controller.isLoading}
          onCreateEncounter={() => controller.navigate('/encounters/new')}
          onOpenEncounter={(encounter) => controller.navigate(`/encounters/${encounter.id}`)}
          onTabChange={controller.handleTabChange}
        />

        <EncounterPagination
          currentPage={controller.currentPage}
          hasNextPage={controller.hasNextPage}
          hasPrevPage={controller.hasPrevPage}
          isLoading={controller.isLoading}
          onGoToPage={controller.goToPage}
          totalCount={controller.totalCount}
          totalPages={controller.totalPages}
        />
      </main>
    </div>
  );
}
