import User from 'lucide-react/dist/esm/icons/user.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Palette from 'lucide-react/dist/esm/icons/palette.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Boxes from 'lucide-react/dist/esm/icons/boxes.js';
import { useNavigate } from 'react-router-dom';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';

/**
 * SettingsHubPage - Central hub for user settings with role-based category cards
 * Chronicle Design: Magazine-style layout with editorial typography
 */
const SettingsHubPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userRole = user?.role;

  const pageMeta = usePageMeta({
    title: 'Settings | HMS',
    breadcrumbs: [
      { label: 'Settings' },
    ],
  });

  // Define all settings categories with role visibility
  const categories = [
    {
      id: 'profile',
      title: 'Profile',
      description: 'Manage your personal information and contact details',
      icon: User,
      color: 'amber',
      route: '/settings/profile',
      roles: null, // All roles
    },
    {
      id: 'security',
      title: 'Security',
      description: 'Password, multi-factor authentication, and active sessions',
      icon: Shield,
      color: 'rose',
      route: '/settings/security',
      roles: null, // All roles
    },
    {
      id: 'preferences',
      title: 'Preferences',
      description: 'Theme, notifications, and display settings',
      icon: Palette,
      color: 'sky',
      route: '/settings/preferences',
      roles: null, // All roles
    },
    {
      id: 'clinical',
      title: 'Clinical Settings',
      description: 'Default templates, order sets, and clinical preferences',
      icon: Stethoscope,
      color: 'emerald',
      route: '/settings/clinical',
      roles: ['doctor', 'nurse', 'lab_technician', 'pharmacist', 'head_nurse', 'nurse_practitioner', 'physician', 'practitioner', 'inpatient_doctor'],
      placeholder: true, // Not yet implemented
    },
    {
      id: 'facility',
      title: 'Facility Settings',
      description: 'Organization structure, departments, and system configuration',
      icon: Building2,
      color: 'amber',
      route: '/admin/organization',
      roles: ['admin'],
    },
    {
      id: 'audit',
      title: 'Audit Logs',
      description: 'View system activity and security events',
      icon: FileText,
      color: 'sky',
      route: '/admin/audit-logs',
      roles: ['admin'],
    },
    {
      id: 'feature-entitlements',
      title: 'Feature Entitlements',
      description: 'Manage clinic, hospital, and network product modules',
      icon: Boxes,
      color: 'emerald',
      route: '/settings/feature-entitlements',
      roles: ['admin'],
    },
  ];

  // Filter categories based on user role
  const visibleCategories = categories.filter(category => {
    if (!category.roles) return true; // Visible to all
    return category.roles.includes(userRole);
  });

  const handleCategoryClick = (category) => {
    if (category.placeholder) {
      return; // Could show a "coming soon" toast
    }
    navigate(category.route);
  };

  return (
    <PageShell>
      {pageMeta}
        <PageHeader
          title={(
            <span className="flex items-center gap-3 sm:gap-4">
              <span className="p-2.5 sm:p-3 rounded-xl bg-primary/10 border border-primary/20">
                <Settings className="h-6 w-6 sm:h-7 sm:w-7 text-primary" aria-hidden="true" />
              </span>
              Settings
            </span>
          )}
          description="Manage your account and preferences"
          contentClassName="max-w-4xl mx-auto w-full"
          descriptionClassName="text-xs sm:text-sm text-muted-foreground font-mono"
        />

        {/* Settings Categories Grid */}
        <main className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {visibleCategories.map((category, index) => (
                <SettingsCategoryCard
                  key={category.id}
                  category={category}
                  index={index}
                  onClick={() => handleCategoryClick(category)}
                />
              ))}
            </div>
          </div>
        </main>
      </PageShell>
  );
};

/**
 * SettingsCategoryCard - Chronicle-styled card for settings navigation
 */
const SettingsCategoryCard = ({ category, index, onClick }) => {
  const { title, description, icon: Icon, color, placeholder } = category;

  const colorConfig = {
    amber: {
      iconBg: 'bg-primary/10',
      iconBorder: 'border-primary/20',
      iconColor: 'text-primary',
      hoverBorder: 'hover:border-primary/40',
      glowColor: 'group-hover:shadow-primary/20',
    },
    emerald: {
      iconBg: 'bg-emerald-500/10',
      iconBorder: 'border-emerald-500/20',
      iconColor: 'text-emerald-400',
      hoverBorder: 'hover:border-emerald-500/40',
      glowColor: 'group-hover:shadow-emerald-500/20',
    },
    rose: {
      iconBg: 'bg-rose-500/10',
      iconBorder: 'border-rose-500/20',
      iconColor: 'text-rose-400',
      hoverBorder: 'hover:border-rose-500/40',
      glowColor: 'group-hover:shadow-rose-500/20',
    },
    sky: {
      iconBg: 'bg-sky-500/10',
      iconBorder: 'border-sky-500/20',
      iconColor: 'text-sky-400',
      hoverBorder: 'hover:border-sky-500/40',
      glowColor: 'group-hover:shadow-sky-500/20',
    },
  };

  const config = colorConfig[color];

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <article
      className={cn(
        'group relative rounded-2xl p-5 sm:p-6',
        'bg-card border border-border',
        'transition-all duration-300 ease-out',
        'cursor-pointer',
        config.hoverBorder,
        'hover:shadow-lg',
        config.glowColor,
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'animate-chronicle-enter',
        placeholder && 'opacity-60'
      )}
      style={{ animationDelay: `${index * 75}ms` }}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`${title}: ${description}`}
    >
      {/* Icon */}
      <div className={cn(
        'w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center mb-4',
        config.iconBg,
        config.iconBorder,
        'border'
      )}>
        <Icon className={cn('h-6 w-6 sm:h-7 sm:w-7', config.iconColor)} aria-hidden="true" />
      </div>

      {/* Content */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg sm:text-xl font-medium text-foreground">
            {title}
          </h3>
          <ChevronRight
            className="h-5 w-5 text-muted-foreground/50 group-hover:text-foreground group-hover:translate-x-1 transition-all"
            aria-hidden="true"
          />
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      </div>

      {/* Placeholder badge */}
      {placeholder && (
        <span className="absolute top-4 right-4 font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          Coming Soon
        </span>
      )}
    </article>
  );
};

export default SettingsHubPage;
