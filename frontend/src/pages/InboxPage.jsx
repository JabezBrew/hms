import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  CheckCircle,
  XCircle,
  Calendar,
  FlaskConical,
  Clock,
  AlertCircle,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';
import { useAuth } from '@/lib/auth';
import {
  useReferralNotifications,
  useMarkNotificationRead,
  useReferralInbox,
} from '@/hooks/useReferralQueries';

/**
 * Notification type configurations - Chronicle color palette
 */
const notificationConfig = {
  referral_submitted: {
    label: 'New Referral',
    icon: FileText,
    nodeClass: 'timeline-node-amber',
    iconClass: 'text-amber-500',
  },
  referral_accepted: {
    label: 'Referral Accepted',
    icon: CheckCircle,
    nodeClass: 'timeline-node-emerald',
    iconClass: 'text-emerald-500',
  },
  referral_declined: {
    label: 'Referral Declined',
    icon: XCircle,
    nodeClass: 'timeline-node-rose',
    iconClass: 'text-rose-500',
  },
  referral_scheduled: {
    label: 'Referral Scheduled',
    icon: Calendar,
    nodeClass: 'timeline-node-sky',
    iconClass: 'text-sky-500',
  },
  referral_completed: {
    label: 'Referral Completed',
    icon: CheckCircle,
    nodeClass: 'timeline-node-emerald',
    iconClass: 'text-emerald-500',
  },
  referral_pending: {
    label: 'Pending Referral',
    icon: Clock,
    nodeClass: 'timeline-node-amber',
    iconClass: 'text-amber-500',
  },
  lab_result: {
    label: 'Lab Result',
    icon: FlaskConical,
    nodeClass: 'timeline-node-sky',
    iconClass: 'text-sky-500',
  },
};

/**
 * Group items by date for timeline display
 */
const groupByDate = (items) => {
  const groups = {};
  items.forEach((item) => {
    let dateKey;
    if (isToday(item.timestamp)) {
      dateKey = 'Today';
    } else if (isYesterday(item.timestamp)) {
      dateKey = 'Yesterday';
    } else {
      dateKey = format(item.timestamp, 'EEEE, MMMM d');
    }
    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(item);
  });
  return groups;
};

/**
 * InboxPage - Chronicle-styled unified inbox
 *
 * Timeline-based design following Chronicle Design System:
 * - font-display for titles
 * - font-mono for timestamps and data
 * - Timeline nodes with color coding
 * - Warm charcoal/cream palette
 */
const InboxPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeFilter, setActiveFilter] = useState('all');

  const isDoctor = user && ['doctor', 'inpatient_doctor'].includes(user.role);

  // Fetch referral notifications
  const { data: notifications = [], isLoading: notificationsLoading, refetch: refetchNotifications } = useReferralNotifications();
  const markAsRead = useMarkNotificationRead();

  // Fetch pending referrals (items requiring action)
  const { data: inboxData, isLoading: inboxLoading, refetch: refetchInbox } = useReferralInbox();
  const pendingReferrals = inboxData?.referrals?.filter(r =>
    ['pending', 'accepted', 'scheduled'].includes(r.status)
  ) || [];

  // Combine into unified items
  const allItems = [];

  // Add notifications
  notifications.forEach((n) => {
    allItems.push({
      id: `notif-${n.id}`,
      type: `referral_${n.event}`,
      category: 'notification',
      title: notificationConfig[`referral_${n.event}`]?.label || 'Referral Update',
      subtitle: `#${n.referral_number} - ${n.referred_to_department}`,
      timestamp: new Date(n.created_at),
      isRead: n.is_read,
      urgency: n.urgency,
      data: n,
      onClick: () => {
        if (!n.is_read) markAsRead.mutate(n.id);
        navigate('/referrals/inbox');
      },
    });
  });

  // Add pending referrals as action items
  pendingReferrals.forEach((r) => {
    const hasNotification = notifications.some(n => n.referral === r.id);
    if (!hasNotification) {
      allItems.push({
        id: `referral-${r.id}`,
        type: 'referral_pending',
        category: 'action',
        title: `${r.patient_name || 'Patient'} - ${r.referred_to_department}`,
        subtitle: `#${r.referral_number} - ${r.reason?.substring(0, 50)}${r.reason?.length > 50 ? '...' : ''}`,
        timestamp: new Date(r.submitted_at || r.created_at),
        isRead: true,
        urgency: r.urgency,
        status: r.status,
        data: r,
        onClick: () => navigate('/referrals/inbox'),
      });
    }
  });

  // Sort by timestamp
  allItems.sort((a, b) => b.timestamp - a.timestamp);

  // Filter items
  const filteredItems = activeFilter === 'all'
    ? allItems
    : activeFilter === 'unread'
    ? allItems.filter(item => !item.isRead)
    : allItems.filter(item => item.category === 'action');

  // Group by date for timeline
  const groupedItems = groupByDate(filteredItems);

  const unreadCount = allItems.filter(item => !item.isRead).length;
  const actionCount = allItems.filter(item => item.category === 'action').length;
  const isLoading = notificationsLoading || inboxLoading;

  const handleRefresh = () => {
    refetchNotifications();
    refetchInbox();
  };

  const filters = [
    { id: 'all', label: 'All', count: allItems.length },
    { id: 'unread', label: 'Unread', count: unreadCount },
    { id: 'action', label: 'Action Required', count: actionCount },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Chronicle-style Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-4 sm:py-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4 sm:mb-6">
            <div>
              <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl text-foreground tracking-tight mb-1">
                Inbox
              </h1>
              <p className="text-sm text-muted-foreground">
                Notifications and items requiring your attention
              </p>
            </div>

            {unreadCount > 0 && (
              <span className="badge-chronicle-amber px-3 py-1 rounded-full text-xs font-mono">
                {unreadCount} unread
              </span>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {filters.map((filter) => (
              <button
                key={filter.id}
                onClick={() => setActiveFilter(filter.id)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-mono transition-all",
                  activeFilter === filter.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
                )}
              >
                {filter.label}
                {filter.count > 0 && (
                  <span className={cn(
                    "ml-2 px-1.5 py-0.5 rounded-full text-[10px]",
                    activeFilter === filter.id
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-background"
                  )}>
                    {filter.count}
                  </span>
                )}
              </button>
            ))}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              className="shrink-0 h-8 w-8"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content - Timeline */}
      <main className="max-w-4xl mx-auto p-4 sm:p-6">
        {isLoading ? (
          <div className="space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-muted rounded w-24 mb-4" />
                <div className="space-y-3">
                  {Array.from({ length: 2 }).map((_, j) => (
                    <div key={j} className="bg-card border border-border rounded-xl p-4">
                      <div className="flex gap-4">
                        <div className="h-10 w-10 bg-muted rounded-full" />
                        <div className="flex-1">
                          <div className="h-4 bg-muted rounded w-1/3 mb-2" />
                          <div className="h-3 bg-muted rounded w-2/3" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Inbox className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-display text-xl text-foreground mb-2">
              {activeFilter === 'unread'
                ? "You're all caught up!"
                : activeFilter === 'action'
                ? 'No items requiring action'
                : 'Your inbox is empty'}
            </h3>
            <p className="text-muted-foreground text-sm max-w-md">
              {activeFilter === 'unread'
                ? 'All notifications have been read.'
                : activeFilter === 'action'
                ? 'There are no pending items that need your attention.'
                : 'New notifications and action items will appear here.'}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedItems).map(([date, items], groupIndex) => (
              <div key={date} className="animate-chronicle-enter" style={{ animationDelay: `${groupIndex * 100}ms` }}>
                {/* Date Header */}
                <div className="flex items-center gap-3 mb-4">
                  <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                    {date}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {/* Timeline Items */}
                <div className="relative">
                  {/* Timeline Spine */}
                  <div className="absolute left-5 top-0 bottom-0 w-px bg-gradient-to-b from-border via-border to-transparent" />

                  <div className="space-y-3">
                    {items.map((item, index) => {
                      const config = notificationConfig[item.type] || notificationConfig.referral_pending;
                      const Icon = config.icon;

                      return (
                        <article
                          key={item.id}
                          onClick={item.onClick}
                          className={cn(
                            "relative pl-12 cursor-pointer group",
                            "animate-chronicle-enter",
                          )}
                          style={{ animationDelay: `${(groupIndex * 100) + (index * 50)}ms` }}
                        >
                          {/* Timeline Node */}
                          <div
                            className={cn(
                              "absolute left-[13px] w-5 h-5 rounded-full flex items-center justify-center",
                              "bg-card border-2 border-border transition-all",
                              "group-hover:scale-110",
                              !item.isRead && "border-primary animate-node-pulse"
                            )}
                          >
                            <div className={cn(
                              "w-2 h-2 rounded-full",
                              item.urgency === 'emergency' ? 'bg-rose-500' :
                              item.urgency === 'urgent' ? 'bg-amber-500' :
                              !item.isRead ? 'bg-primary' : 'bg-muted-foreground/50'
                            )} />
                          </div>

                          {/* Content Card */}
                          <div
                            className={cn(
                              "bg-card border border-border rounded-xl p-4 transition-all",
                              "hover:bg-card/80 hover:border-border/80 hover:shadow-lg",
                              !item.isRead && "border-l-2 border-l-primary bg-primary/5"
                            )}
                          >
                            <div className="flex gap-4">
                              {/* Icon */}
                              <div
                                className={cn(
                                  "h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0",
                                  "bg-muted/50"
                                )}
                              >
                                <Icon className={cn('h-5 w-5', config.iconClass)} />
                              </div>

                              {/* Details */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={cn(
                                      "font-heading font-medium text-sm",
                                      !item.isRead && "text-foreground"
                                    )}>
                                      {item.title}
                                    </span>
                                    {!item.isRead && (
                                      <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                                    )}
                                  </div>
                                  <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">
                                    {format(item.timestamp, 'h:mm a')}
                                  </span>
                                </div>

                                <p className="font-mono text-xs text-muted-foreground mt-1 truncate">
                                  {item.subtitle}
                                </p>

                                {/* Badges */}
                                <div className="flex items-center gap-2 mt-3 flex-wrap">
                                  {item.urgency === 'emergency' && (
                                    <span className="badge-chronicle-rose text-[10px] px-2 py-0.5 rounded-full">
                                      EMERGENCY
                                    </span>
                                  )}
                                  {item.urgency === 'urgent' && (
                                    <span className="badge-chronicle-amber text-[10px] px-2 py-0.5 rounded-full">
                                      URGENT
                                    </span>
                                  )}
                                  {item.status === 'pending' && (
                                    <span className="badge-chronicle-amber text-[10px] px-2 py-0.5 rounded-full">
                                      PENDING
                                    </span>
                                  )}
                                  {item.status === 'accepted' && (
                                    <span className="badge-chronicle-emerald text-[10px] px-2 py-0.5 rounded-full">
                                      ACCEPTED
                                    </span>
                                  )}
                                  {item.status === 'scheduled' && (
                                    <span className="badge-chronicle-sky text-[10px] px-2 py-0.5 rounded-full">
                                      SCHEDULED
                                    </span>
                                  )}
                                  {item.category === 'action' && (
                                    <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 font-mono">
                                      <AlertCircle className="h-3 w-3" />
                                      ACTION REQUIRED
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default InboxPage;
