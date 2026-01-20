/**
 * RosterSettingsPage - Configuration page for roster system
 * Handles infrequently-changed settings: shifts, duty types, patterns, plans, etc.
 * Chronicle Design System styling
 */
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Clipboard from 'lucide-react/dist/esm/icons/clipboard.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import Layers from 'lucide-react/dist/esm/icons/layers.js';
import Grid from 'lucide-react/dist/esm/icons/grid-3x3.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import UploadCloud from 'lucide-react/dist/esm/icons/upload-cloud.js';

// Tab imports - configuration tabs
import { ShiftDefinitionsTab } from './duty-roster/ShiftDefinitionsTab';
import { DutyTypesTab } from './duty-roster/DutyTypesTab';
import { StationsTab } from './duty-roster/StationsTab';
import { DepartmentRosterPlansTab } from './duty-roster/DepartmentRosterPlansTab';
import { RosterPatternsTab } from './duty-roster/RosterPatternsTab';
import { RosterPatternSlotsTab } from './duty-roster/RosterPatternSlotsTab';
import { TeamRosterPlansTab } from './duty-roster/TeamRosterPlansTab';
import { TemplatesTab } from './duty-roster/TemplatesTab';
import { RosterImportsTab } from './duty-roster/RosterImportsTab';

const SETTINGS_SECTIONS = [
  {
    id: 'definitions',
    label: 'Definitions',
    description: 'Core building blocks for your roster',
    tabs: [
      { value: 'shifts', label: 'Shift Definitions', icon: Clock, description: 'Define shift times and names' },
      { value: 'duty-types', label: 'Duty Types', icon: Clipboard, description: 'Types of duties staff can perform' },
      { value: 'stations', label: 'Stations', icon: MapPin, description: 'Physical locations for assignments' },
    ],
  },
  {
    id: 'plans',
    label: 'Roster Plans',
    description: 'Configure how rosters are generated',
    tabs: [
      { value: 'dept-plans', label: 'Department Plans', icon: CalendarIcon, description: 'Department-level roster plans' },
      { value: 'team-plans', label: 'Team Plans', icon: Users, description: 'Team-specific roster plans' },
    ],
  },
  {
    id: 'patterns',
    label: 'Patterns & Templates',
    description: 'Repeating schedules and templates',
    tabs: [
      { value: 'patterns', label: 'Roster Patterns', icon: Layers, description: 'Recurring rotation patterns' },
      { value: 'pattern-slots', label: 'Pattern Slots', icon: Grid, description: 'Individual slots within patterns' },
      { value: 'templates', label: 'Templates', icon: RefreshCw, description: 'Reusable roster templates' },
    ],
  },
  {
    id: 'data',
    label: 'Data Management',
    description: 'Import and manage roster data',
    tabs: [
      { value: 'imports', label: 'Import Rosters', icon: UploadCloud, description: 'Bulk import roster data' },
    ],
  },
];

// Flatten tabs for easy lookup
const ALL_TABS = SETTINGS_SECTIONS.flatMap((section) => section.tabs);

export default function RosterSettingsPage() {
  const [activeTab, setActiveTab] = useState('shifts');

  const activeTabConfig = ALL_TABS.find((t) => t.value === activeTab);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'shifts':
        return <ShiftDefinitionsTab />;
      case 'duty-types':
        return <DutyTypesTab />;
      case 'stations':
        return <StationsTab />;
      case 'dept-plans':
        return <DepartmentRosterPlansTab />;
      case 'team-plans':
        return <TeamRosterPlansTab />;
      case 'patterns':
        return <RosterPatternsTab />;
      case 'pattern-slots':
        return <RosterPatternSlotsTab />;
      case 'templates':
        return <TemplatesTab />;
      case 'imports':
        return <RosterImportsTab />;
      default:
        return <ShiftDefinitionsTab />;
    }
  };

  return (
    <>
      <Helmet>
        <title>Roster Settings | Organization</title>
      </Helmet>

      <div className="min-h-screen bg-background">
        <div className="container max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <header className="mb-8">
            <div className="flex items-center gap-4 mb-4">
              <Button variant="ghost" size="sm" asChild className="gap-2">
                <Link to="/admin/organization/duty-roster">
                  <ArrowLeft className="h-4 w-4" />
                  <span className="font-mono text-xs">Back to Roster</span>
                </Link>
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center">
                <Settings className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
                  Roster Settings
                </h1>
                <p className="mt-1 text-muted-foreground text-sm">
                  Configure the building blocks for your duty roster system.
                </p>
              </div>
            </div>
          </header>

          <div className="flex gap-8">
            {/* Sidebar Navigation */}
            <nav className="w-64 shrink-0">
              <div className="sticky top-8 space-y-6">
                {SETTINGS_SECTIONS.map((section) => (
                  <div key={section.id}>
                    <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2 px-3">
                      {section.label}
                    </h3>
                    <div className="space-y-1">
                      {section.tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.value;
                        return (
                          <button
                            key={tab.value}
                            onClick={() => setActiveTab(tab.value)}
                            className={cn(
                              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                              isActive
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="text-sm font-medium">{tab.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </nav>

            {/* Main Content */}
            <main className="flex-1 min-w-0">
              {/* Tab Header */}
              {activeTabConfig && (
                <div className="mb-6 pb-6 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <activeTabConfig.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="font-heading text-xl font-semibold">{activeTabConfig.label}</h2>
                      <p className="text-sm text-muted-foreground">{activeTabConfig.description}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab Content */}
              <div className="animate-chronicle-enter">
                {renderTabContent()}
              </div>
            </main>
          </div>
        </div>
      </div>
    </>
  );
}
