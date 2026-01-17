import Bell from 'lucide-react/dist/esm/icons/bell.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import formatDistanceToNow from 'date-fns/formatDistanceToNow';
import { toast } from 'sonner';
import {
  useReferralNotifications,
  useReferralNotificationCount,
  useMarkNotificationRead,
} from '@/hooks/useReferralQueries';
import { useNotificationWebSocket } from '@/hooks/useWebSocket';

/**
 * Event configuration for notification display
 */
const eventConfig = {
  submitted: {
    label: 'New Referral',
    icon: FileText,
    iconClass: 'text-amber-500',
    bgClass: 'bg-amber-500/10',
  },
  accepted: {
    label: 'Referral Accepted',
    icon: CheckCircle,
    iconClass: 'text-emerald-500',
    bgClass: 'bg-emerald-500/10',
  },
  declined: {
    label: 'Referral Declined',
    icon: XCircle,
    iconClass: 'text-rose-500',
    bgClass: 'bg-rose-500/10',
  },
  scheduled: {
    label: 'Referral Scheduled',
    icon: Calendar,
    iconClass: 'text-sky-500',
    bgClass: 'bg-sky-500/10',
  },
  completed: {
    label: 'Referral Completed',
    icon: CheckCircle,
    iconClass: 'text-emerald-500',
    bgClass: 'bg-emerald-500/10',
  },
};

/**
 * Urgency badge configuration
 */
const urgencyConfig = {
  routine: { label: 'Routine', className: 'bg-muted text-muted-foreground' },
  urgent: { label: 'Urgent', className: 'badge-chronicle-amber' },
  emergency: { label: 'Emergency', className: 'badge-chronicle-rose' },
};

/**
 * ReferralNotificationBell - Header notification bell for referral notifications
 * Only visible to doctors
 */
const ReferralNotificationBell = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Fetch notifications and count
  const { data: notifications = [], isLoading } = useReferralNotifications();
  const { data: unreadCount = 0 } = useReferralNotificationCount();
  const markAsRead = useMarkNotificationRead();

  // WebSocket for real-time updates
  useNotificationWebSocket({
    onNotification: (notification) => {
      const config = eventConfig[notification.event] || eventConfig.submitted;
      toast.info(config.label, {
        description: `Referral #${notification.referral_number} to ${notification.referred_to_department}`,
        action: {
          label: 'View',
          onClick: () => handleNotificationClick(notification),
        },
      });
    },
  });

  // Handle notification click
  const handleNotificationClick = (notification) => {
    // Mark as read if not already
    if (!notification.is_read) {
      markAsRead.mutate(notification.id);
    }

    setOpen(false);

    // Navigate to referral inbox
    navigate('/referrals/inbox');
  };

  // Handle view all click
  const handleViewAll = () => {
    setOpen(false);
    navigate('/referrals/inbox');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="p-4 font-medium flex items-center justify-between">
          <span>Referral Notifications</span>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {unreadCount} unread
            </Badge>
          )}
        </div>
        <Separator />
        <ScrollArea className="max-h-96">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground">
              Loading notifications...
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No notifications yet</p>
              <p className="text-xs mt-1">
                Referral updates will appear here
              </p>
            </div>
          ) : (
            <div>
              {notifications.slice(0, 10).map((notification) => {
                const config = eventConfig[notification.event] || eventConfig.submitted;
                const urgency = urgencyConfig[notification.urgency] || urgencyConfig.routine;
                const Icon = config.icon;

                return (
                  <div
                    key={notification.id}
                    className={cn(
                      'p-4 hover:bg-muted cursor-pointer border-b last:border-b-0 transition-colors',
                      !notification.is_read && 'bg-primary/5'
                    )}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex gap-3">
                      <div
                        className={cn(
                          'h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0',
                          config.bgClass
                        )}
                      >
                        <Icon className={cn('h-4 w-4', config.iconClass)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm truncate">
                            {config.label}
                          </span>
                          {!notification.is_read && (
                            <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          #{notification.referral_number} to{' '}
                          {notification.referred_to_department}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={cn(
                              'text-xs px-1.5 py-0.5 rounded',
                              urgency.className
                            )}
                          >
                            {urgency.label}
                          </span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(notification.created_at), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
        <Separator />
        <div className="p-2">
          <Button
            variant="ghost"
            className="w-full justify-center text-sm"
            onClick={handleViewAll}
          >
            View All Referrals
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ReferralNotificationBell;
