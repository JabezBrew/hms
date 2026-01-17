import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  FileText,
  CheckCircle,
  XCircle,
  Calendar,
  User,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { fetchUpcomingAppointments } from '@/lib/api';
import {
  useReferralNotifications,
  useReferralNotificationCount,
  useMarkNotificationRead,
} from '@/hooks/useReferralQueries';
import { useNotificationWebSocket } from '@/hooks/useWebSocket';

/**
 * Notification type configurations - Chronicle color palette
 */
const notificationConfig = {
  // Referral events
  referral_submitted: {
    label: 'New Referral',
    icon: FileText,
    iconClass: 'text-amber-500',
  },
  referral_accepted: {
    label: 'Referral Accepted',
    icon: CheckCircle,
    iconClass: 'text-emerald-500',
  },
  referral_declined: {
    label: 'Referral Declined',
    icon: XCircle,
    iconClass: 'text-rose-500',
  },
  referral_scheduled: {
    label: 'Referral Scheduled',
    icon: Calendar,
    iconClass: 'text-sky-500',
  },
  referral_completed: {
    label: 'Referral Completed',
    icon: CheckCircle,
    iconClass: 'text-emerald-500',
  },
  // Appointment
  appointment: {
    label: 'Upcoming Appointment',
    icon: User,
    iconClass: 'text-sky-500',
  },
};

/**
 * NotificationCenter - Unified notification bell
 */
const NotificationCenter = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  const isDoctor = user && ['doctor', 'inpatient_doctor'].includes(user.role);
  const hasAppointmentAccess = user && ['admin', 'doctor', 'nurse', 'receptionist', 'inpatient_doctor'].includes(user.role);

  // Appointment notifications
  const { data: appointments = [], isLoading: appointmentsLoading } = useQuery({
    queryKey: ['upcomingAppointments'],
    queryFn: fetchUpcomingAppointments,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: hasAppointmentAccess,
  });

  // Referral notifications (only for doctors)
  const { data: referralNotifications = [], isLoading: referralsLoading } = useReferralNotifications();
  const { data: unreadReferralCount = 0 } = useReferralNotificationCount();
  const markAsRead = useMarkNotificationRead();

  // WebSocket for real-time referral updates
  useNotificationWebSocket({
    enabled: isDoctor,
    onNotification: (notification) => {
      const config = notificationConfig[`referral_${notification.event}`] || notificationConfig.referral_submitted;
      toast.info(config.label, {
        description: `Referral #${notification.referral_number} to ${notification.referred_to_department}`,
        action: {
          label: 'View',
          onClick: () => {
            setOpen(false);
            navigate('/referrals/inbox');
          },
        },
      });
    },
  });

  // Combine and sort all notifications by time
  const allNotifications = useMemo(() => {
    const items = [];

    // Add referral notifications (for doctors)
    if (isDoctor) {
      referralNotifications.forEach((n) => {
        items.push({
          id: n.id,
          type: `referral_${n.event}`,
          title: notificationConfig[`referral_${n.event}`]?.label || 'Referral Update',
          subtitle: `#${n.referral_number} - ${n.referred_to_department}`,
          timestamp: new Date(n.created_at),
          isRead: n.is_read,
          urgency: n.urgency,
          onClick: () => {
            if (!n.is_read) markAsRead.mutate(n.id);
            setOpen(false);
            navigate('/referrals/inbox');
          },
        });
      });
    }

    // Add appointments
    if (hasAppointmentAccess) {
      appointments.forEach((a) => {
        items.push({
          id: a.id,
          type: 'appointment',
          title: a.patientName,
          subtitle: `${a.type} - ${a.startTime}`,
          timestamp: new Date(a.startDateTime || Date.now()),
          isRead: true, // Appointments don't have read state
          onClick: () => {
            setOpen(false);
            navigate(`/appointments/${a.id}`);
          },
        });
      });
    }

    // Sort by timestamp descending
    return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 15);
  }, [referralNotifications, appointments, isDoctor, hasAppointmentAccess, markAsRead, navigate]);

  // Calculate total count
  const totalCount = appointments.length + (isDoctor ? unreadReferralCount : 0);
  const isLoading = appointmentsLoading || (isDoctor && referralsLoading);

  // Count unread notifications
  const unreadCount = allNotifications.filter(n => !n.isRead).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {totalCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-[10px] font-mono bg-primary text-primary-foreground rounded-full">
              {totalCount > 99 ? '99+' : totalCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 bg-card border-border" align="end">
        {/* Chronicle-style Header */}
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <span className="badge-chronicle-amber text-[10px] px-2 py-0.5 rounded-full font-mono">
                {unreadCount} new
              </span>
            )}
          </div>
        </div>

        <ScrollArea className="max-h-80">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="h-8 w-8 bg-muted rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded w-2/3" />
                    <div className="h-2 bg-muted rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : allNotifications.length === 0 ? (
            <div className="py-12 px-4 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <Bell className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-heading text-sm text-foreground mb-1">No notifications</p>
              <p className="text-xs text-muted-foreground">You're all caught up!</p>
            </div>
          ) : (
            <div className="py-2">
              {allNotifications.map((item, index) => {
                const config = notificationConfig[item.type] || notificationConfig.appointment;
                const Icon = config.icon;

                return (
                  <div
                    key={`${item.type}-${item.id}`}
                    className={cn(
                      'px-4 py-3 cursor-pointer transition-all hover:bg-muted/50',
                      !item.isRead && 'bg-primary/5 border-l-2 border-l-primary',
                      'animate-chronicle-enter'
                    )}
                    style={{ animationDelay: `${index * 30}ms` }}
                    onClick={item.onClick}
                  >
                    <div className="flex gap-3">
                      {/* Icon with Chronicle styling */}
                      <div className="h-8 w-8 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0">
                        <Icon className={cn('h-4 w-4', config.iconClass)} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-heading font-medium text-sm truncate text-foreground">
                            {item.title}
                          </span>
                          {!item.isRead && (
                            <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0 animate-node-pulse" />
                          )}
                        </div>
                        <p className="font-mono text-[11px] text-muted-foreground truncate mt-0.5">
                          {item.subtitle}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {formatDistanceToNow(item.timestamp, { addSuffix: true })}
                          </span>
                          {item.urgency === 'urgent' && (
                            <span className="badge-chronicle-amber text-[9px] px-1.5 py-0.5 rounded-full">
                              URGENT
                            </span>
                          )}
                          {item.urgency === 'emergency' && (
                            <span className="badge-chronicle-rose text-[9px] px-1.5 py-0.5 rounded-full">
                              EMERGENCY
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Chronicle-style Footer */}
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            className="w-full justify-center font-mono text-xs gap-2 hover:bg-muted"
            onClick={() => {
              setOpen(false);
              navigate('/inbox');
            }}
          >
            View All
            <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationCenter;
