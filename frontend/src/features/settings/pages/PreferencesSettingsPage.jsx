import Palette from 'lucide-react/dist/esm/icons/palette.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import Sun from 'lucide-react/dist/esm/icons/sun.js';
import Moon from 'lucide-react/dist/esm/icons/moon.js';
import Monitor from 'lucide-react/dist/esm/icons/monitor.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import { useNavigate } from 'react-router-dom';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';

/**
 * PreferencesSettingsPage - Theme, notifications, and display settings
 * Chronicle Design: Sky accent for preferences, editorial typography
 */
const PreferencesSettingsPage = () => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const themeOptions = [
    {
      id: 'system',
      label: 'Use device theme',
      description: 'Follow this device’s light or dark appearance',
      icon: Monitor,
      preview: 'bg-muted border-border',
    },
    {
      id: 'light',
      label: 'Light',
      description: 'Bright and clear for daytime use',
      icon: Sun,
      preview: 'bg-white border-slate-200',
    },
    {
      id: 'dark',
      label: 'Dark',
      description: 'Easy on the eyes in low light',
      icon: Moon,
      preview: 'bg-slate-900 border-slate-700',
    },
  ];

  const pageMeta = usePageMeta({
    title: 'Preferences | HMS',
    breadcrumbs: [
      { label: 'Settings', href: '/settings' },
      { label: 'Preferences' },
    ],
  });

  return (
    <PageShell>
      {pageMeta}
        <PageHeader
          title={(
            <span className="flex items-center gap-3 sm:gap-4">
              <span className="p-2.5 sm:p-3 rounded-xl bg-primary/10 border border-primary/20">
                <Palette className="size-6 sm:h-7 sm:w-7 text-primary" aria-hidden="true" />
              </span>
              Preferences
            </span>
          )}
          description="Make your workspace comfortable for each shift"
          contentClassName="max-w-2xl mx-auto w-full"
          descriptionClassName="text-xs sm:text-sm text-muted-foreground font-mono"
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/settings')}
            className="-ml-2 font-mono text-xs"
          >
            <ArrowLeft className="size-4 mr-2" />
            Back to Settings
          </Button>
        </PageHeader>

        {/* Main Content */}
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Theme Section */}
            <section className="bg-card border border-border rounded-2xl p-5 sm:p-6 animate-chronicle-enter">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                  <Sun className="size-4 text-primary" aria-hidden="true" />
                </div>
                <h2 className="font-display text-lg text-foreground">
                  Appearance
                </h2>
              </div>
              <p className="text-sm text-muted-foreground mb-5 sm:ml-11">
                Changes apply immediately and are saved on this device.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const isSelected = theme === option.id;

                  return (
                    <button
                      type="button"
                      key={option.id}
                      onClick={() => setTheme(option.id)}
                      className={cn(
                        'group relative flex flex-col items-start p-4 rounded-xl border-2 text-left transition-all duration-200',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50 hover:bg-muted/50'
                      )}
                      aria-pressed={isSelected}
                    >
                      {/* Theme Preview */}
                      <div className={cn(
                        'w-full h-20 rounded-lg border mb-3 overflow-hidden',
                        option.preview
                      )}>
                        <div className="p-2 space-y-1.5">
                          <div className={cn(
                            'h-2 w-12 rounded',
                            option.id === 'dark' ? 'bg-slate-700' : 'bg-muted-foreground/20'
                          )} />
                          <div className={cn(
                            'h-2 w-20 rounded',
                            option.id === 'dark' ? 'bg-slate-700' : 'bg-muted-foreground/20'
                          )} />
                          <div className={cn(
                            'h-2 w-16 rounded',
                            option.id === 'dark' ? 'bg-slate-700' : 'bg-muted-foreground/20'
                          )} />
                        </div>
                      </div>

                      {/* Label and icon */}
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <Icon
                            className={cn(
                              'size-4',
                              isSelected ? 'text-primary' : 'text-muted-foreground'
                            )}
                            aria-hidden="true"
                          />
                          <span className={cn(
                            'font-display text-base font-medium',
                            isSelected ? 'text-primary' : 'text-foreground'
                          )}>
                            {option.label}
                          </span>
                        </div>
                        {isSelected && (
                          <div className="size-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="size-3 text-primary-foreground" aria-hidden="true" />
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {option.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>


          </div>
        </div>
      </PageShell>
  );
};

export default PreferencesSettingsPage;
