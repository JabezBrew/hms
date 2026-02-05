import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import format from 'date-fns/format';

/**
 * ChroniclePageHeader - Dashboard page header with Chronicle styling
 *
 * @param {Object} props
 * @param {string} props.title - Page title
 * @param {string} props.role - User role (displayed as badge)
 * @param {string} props.subtitle - Optional subtitle
 * @param {ReactNode} props.actions - Optional action buttons
 * @param {boolean} props.showDate - Show current date (default: true)
 * @param {ReactNode} props.children - Additional header content
 */
export default function ChroniclePageHeader({
  title,
  role,
  subtitle,
  actions,
  showDate = true,
  children,
}) {
  const roleColors = {
    nurse: 'emerald',
    doctor: 'amber',
    inpatient_doctor: 'amber',
    receptionist: 'sky',
    admin: 'rose',
  };

  const roleColor = roleColors[role] || 'amber';

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="p-4 sm:p-6">
        {/* Top row - Title, role, and date */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
              <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl text-foreground truncate">
                {title}
              </h1>
              {role && (
                <Badge className={`badge-chronicle-${roleColor} text-[10px] sm:text-xs uppercase shrink-0`}>
                  {role.replace('_', ' ')}
                </Badge>
              )}
            </div>
            {subtitle && (
              <p className="text-sm sm:text-base text-muted-foreground font-heading">
                {subtitle}
              </p>
            )}
          </div>

          {/* Date and actions */}
          <div className="flex flex-col sm:items-end gap-2">
            {showDate && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span className="font-mono text-xs sm:text-sm">
                  {format(new Date(), 'EEE, MMM d, yyyy')}
                </span>
              </div>
            )}
            {actions && (
              <div className="flex gap-2">
                {actions}
              </div>
            )}
          </div>
        </div>

        {/* Additional content */}
        {children}
      </div>
    </header>
  );
}
