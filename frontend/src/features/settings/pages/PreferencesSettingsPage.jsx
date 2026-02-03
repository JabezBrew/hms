import Palette from 'lucide-react/dist/esm/icons/palette.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import Sun from 'lucide-react/dist/esm/icons/sun.js';
import Moon from 'lucide-react/dist/esm/icons/moon.js';
import Bell from 'lucide-react/dist/esm/icons/bell.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';

/**
 * PreferencesSettingsPage - Theme, notifications, and display settings
 * Chronicle Design: Sky accent for preferences, editorial typography
 */
const PreferencesSettingsPage = () => {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const themeOptions = [
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

  return (
    <>
      <Helmet>
        <title>Preferences | HMS</title>
        <meta name="description" content="Customize your experience" />
      </Helmet>

      <div className="min-h-screen bg-background">
        {/* Page Header - Chronicle style with sky accent */}
        <header className="bg-card border-b border-border px-4 sm:px-6 py-6">
          <div className="max-w-2xl mx-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/settings')}
              className="mb-4 -ml-2 font-mono text-xs"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Settings
            </Button>

            <div className="flex items-center gap-3 sm:gap-4">
              <div className="p-2.5 sm:p-3 rounded-xl bg-sky-500/10 border border-sky-500/20">
                <Palette className="h-6 w-6 sm:h-7 sm:w-7 text-sky-400" aria-hidden="true" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl text-foreground tracking-tight">
                  Preferences
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground font-mono mt-0.5">
                  Customize your experience
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Theme Section */}
            <section className="bg-card border border-border rounded-2xl p-5 sm:p-6 animate-chronicle-enter">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/20">
                  <Sun className="h-4 w-4 text-sky-400" aria-hidden="true" />
                </div>
                <h2 className="font-display text-lg text-foreground">
                  Appearance
                </h2>
              </div>
              <p className="text-sm text-muted-foreground mb-5 ml-11">
                Choose how the application looks to you.
              </p>

              <div className="ml-11 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const isSelected = theme === option.id;

                  return (
                    <button
                      key={option.id}
                      onClick={() => setTheme(option.id)}
                      className={cn(
                        'group relative flex flex-col items-start p-4 rounded-xl border-2 text-left transition-all duration-200',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        isSelected
                          ? 'border-sky-400 bg-sky-500/5'
                          : 'border-border hover:border-sky-400/50 hover:bg-muted/50'
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
                            option.id === 'dark' ? 'bg-slate-700' : 'bg-slate-200'
                          )} />
                          <div className={cn(
                            'h-2 w-20 rounded',
                            option.id === 'dark' ? 'bg-slate-700' : 'bg-slate-200'
                          )} />
                          <div className={cn(
                            'h-2 w-16 rounded',
                            option.id === 'dark' ? 'bg-slate-700' : 'bg-slate-200'
                          )} />
                        </div>
                      </div>

                      {/* Label and icon */}
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <Icon
                            className={cn(
                              'h-4 w-4',
                              isSelected ? 'text-sky-400' : 'text-muted-foreground'
                            )}
                            aria-hidden="true"
                          />
                          <span className={cn(
                            'font-display text-base font-medium',
                            isSelected ? 'text-sky-400' : 'text-foreground'
                          )}>
                            {option.label}
                          </span>
                        </div>
                        {isSelected && (
                          <div className="w-5 h-5 rounded-full bg-sky-400 flex items-center justify-center">
                            <Check className="h-3 w-3 text-white" aria-hidden="true" />
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

            {/* Notifications Section - Placeholder */}
            <section className="bg-card border border-border rounded-2xl p-5 sm:p-6 animate-chronicle-enter" style={{ animationDelay: '75ms' }}>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                  <Bell className="h-4 w-4 text-primary" aria-hidden="true" />
                </div>
                <h2 className="font-display text-lg text-foreground">
                  Notifications
                </h2>
              </div>
              <p className="text-sm text-muted-foreground mb-5 ml-11">
                Control how you receive notifications.
              </p>

              <div className="ml-11 bg-muted/30 border border-border rounded-xl p-5">
                <div className="flex items-center gap-3">
                  <Bell className="h-8 w-8 text-primary" />
                  <div>
                    <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-1">
                      Coming Soon
                    </p>
                    <p className="text-sm text-foreground">
                      Notification preferences will allow you to customize alerts, sounds, and email notifications.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </>
  );
};

export default PreferencesSettingsPage;
