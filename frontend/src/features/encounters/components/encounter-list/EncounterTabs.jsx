import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ENCOUNTER_TABS } from './encounterListConstants';
import { EncounterTable } from './EncounterTable';

export function EncounterTabs({
  activeTab,
  encounters,
  isLoading,
  onCreateEncounter,
  onOpenEncounter,
  onTabChange,
}) {
  return (
    <Tabs defaultValue="all" value={activeTab} onValueChange={onTabChange}>
      <TabsList className="bg-card border border-border rounded-xl p-1 h-auto">
        {ENCOUNTER_TABS.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="font-mono text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg px-4 py-2"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {ENCOUNTER_TABS.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="mt-6">
          <EncounterTable
            encounters={encounters}
            isLoading={isLoading}
            onCreateEncounter={onCreateEncounter}
            onOpenEncounter={onOpenEncounter}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
