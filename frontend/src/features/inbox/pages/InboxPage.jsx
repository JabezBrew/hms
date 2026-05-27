import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Inbox from 'lucide-react/dist/esm/icons/inbox.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import format from 'date-fns/format';
import isToday from 'date-fns/isToday';
import isYesterday from 'date-fns/isYesterday';
import { useInboxCounts, useInboxItems, useMarkInboxRead } from '@/features/inbox/hooks';

/**
 * Notification type configurations - Chronicle color palette
 */
const notificationConfig = {
  referral: {
    label: 'Referral Update',
    icon: FileText,
    nodeClass: 'timeline-node-amber',
    iconClass: 'text-amber-500',
  },
  nursing_alert: {
    label: 'Nursing Alert',
    icon: AlertCircle,
    nodeClass: 'timeline-node-rose',
    iconClass: 'text-rose-500',
  },
  nursing_task: {
    label: 'Nursing Task',
    icon: Clock,
    nodeClass: 'timeline-node-amber',
    iconClass: 'text-amber-500',
  },
  drug_safety: {
    label: 'Drug Safety',
    icon: FlaskConical,
    nodeClass: 'timeline-node-rose',
    iconClass: 'text-rose-500',
  },
  lab_result: {
    label: 'Lab Result',
    icon: Calendar,
    nodeClass: 'timeline-node-sky',
    iconClass: 'text-sky-500',
  },
  default: {
    label: 'Inbox Item',
    icon: Inbox,
    nodeClass: 'timeline-node-amber',
    iconClass: 'text-amber-500',
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
  const [activeFilter, setActiveFilter] = useState('all');

  const inboxParams = useMemo(() => {
    if (activeFilter === 'unread') {
      return { status: 'unread' };
    }
    if (activeFilter === 'action') {
      return { action_required: true };
    }
    return {};
  }, [activeFilter]);

  const { data: inboxData, isLoading, refetch: refetchInbox } = useInboxItems(inboxParams);
  const { data: inboxCountData, refetch: refetchCounts } = useInboxCounts();
  const markInboxRead = useMarkInboxRead();

  const inboxItems = inboxData?.results || [];

  const handleInboxItemClick = useCallback((item) => {
    if (item.action_url) {
      navigate(item.action_url);
    }
  }, [navigate]);

  const handleMarkRead = useCallback((event, item) => {
    event.stopPropagation();
    if (item.id) {
      markInboxRead.mutate(item.id);
    }
  }, [markInboxRead]);

  const allItems = useMemo(() => inboxItems.map((item) => ({
    id: item.id,
    type: item.source_type,
    category: item.is_action_required ? 'action' : 'notification',
    title: item.title,
    subtitle: item.summary,
    timestamp: new Date(item.occurred_at),
    isRead: item.is_read || item.status === 'read' || item.status === 'done' || item.status === 'acknowledged',
    urgency: item.priority,
    data: item,
  })), [inboxItems]);

  const unreadCount = inboxCountData?.unread ?? 0;
  const actionCount = inboxCountData?.action_required ?? 0;
  const totalCount = inboxCountData?.total ?? allItems.length;

  const resolvedTotalCount = Math.max(totalCount, unreadCount + actionCount);

  const filteredItems = useMemo(() => {
    if (activeFilter === 'unread') {
      return allItems.filter((item) => !item.isRead);
    }
    if (activeFilter === 'action') {
      return allItems.filter((item) => item.category === 'action');
    }
    return allItems;
  }, [activeFilter, allItems]);

  const groupedItems = useMemo(() => groupByDate(filteredItems), [filteredItems]);

  const handleRefresh = () => {
    refetchInbox();
    refetchCounts();
  };

  const filters = [
    { id: 'all', label: 'All', count: resolvedTotalCount },
    { id: 'unread', label: 'Unread', count: unreadCount },
    { id: 'action', label: 'Action Required', count: actionCount },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Inbox"
        description="Notifications and items requiring your attention"
        actions={unreadCount > 0 ? (
          <span className="badge-chronicle-amber px-3 py-1 rounded-full text-xs font-mono">
            {unreadCount} unread
          </span>
        ) : null}
        contentClassName="max-w-4xl mx-auto w-full"
      >
        <div className="flex items-center gap-2 flex-wrap mt-4 sm:mt-6">
          {filters.map((filter) => (
            <button
              type="button"
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
            className="shrink-0 size-8"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </PageHeader>

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
                        <div className="size-10 bg-muted rounded-full" />
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
            <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Inbox className="size-8 text-muted-foreground" />
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
                      const config = notificationConfig[item.type] || notificationConfig.default;
                      const Icon = config.icon;

                      const handleClick = () => handleInboxItemClick(item.data);
                      const badgeClass = item.urgency === 'emergency'
                        ? 'badge-chronicle-rose'
                        : item.urgency === 'urgent'
                        ? 'badge-chronicle-amber'
                        : item.urgency === 'normal'
                        ? 'badge-chronicle-sky'
                        : 'badge-chronicle-emerald';
                      const indicatorClass = item.urgency === 'emergency'
                        ? 'bg-rose-500'
                        : item.urgency === 'urgent'
                        ? 'bg-amber-500'
                        : item.urgency === 'normal'
                        ? 'bg-sky-500'
                        : item.urgency === 'routine'
                        ? 'bg-emerald-500'
                        : !item.isRead
                        ? 'bg-primary'
                        : 'bg-muted-foreground/50';

                      const handleMessageKeyDown = (event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        handleClick();
                      };

                      return (
                        <div
                          key={item.id}
                          onClick={handleClick}
                          onKeyDown={handleMessageKeyDown}
                          role="button"
                          tabIndex={0}
                          aria-label={`Open inbox item ${item.title}`}
                          className={cn(
                            "relative pl-12 cursor-pointer group",
                            "animate-chronicle-enter",
                          )}
                          style={{ animationDelay: `${(groupIndex * 100) + (index * 50)}ms` }}
                        >
                          {/* Timeline Node */}
                          <div
                            className={cn(
                              "absolute left-[13px] size-5 rounded-full flex items-center justify-center",
                              "bg-card border-2 border-border transition-all",
                              "group-hover:scale-110",
                              !item.isRead && "border-primary animate-node-pulse"
                            )}
                          >
                            <div className={cn(
                              "size-2 rounded-full",
                              indicatorClass
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
                                  "size-10 rounded-full flex items-center justify-center flex-shrink-0",
                                  "bg-muted/50"
                                )}
                              >
                                <Icon className={cn('size-5', config.iconClass)} />
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
                                      <span className="size-2 rounded-full bg-primary flex-shrink-0" />
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
                                <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {item.urgency && (
                                      <span className={cn(
                                        badgeClass,
                                        "text-[10px] px-2 py-0.5 rounded-full uppercase"
                                      )}>
                                        {item.urgency.replace('_', ' ')}
                                      </span>
                                    )}
                                    {item.category === 'action' && (
                                      <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 font-mono">
                                        <AlertCircle className="size-3" />
                                        ACTION REQUIRED
                                      </span>
                                    )}
                                  </div>
                                  {!item.isRead && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2 font-mono text-[10px]"
                                      disabled={markInboxRead.isPending}
                                      onClick={(event) => handleMarkRead(event, item)}
                                    >
                                      <Check className="size-3.5 mr-1" />
                                      Mark read
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </PageShell>
  );
};

export default InboxPage;
