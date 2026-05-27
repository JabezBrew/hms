import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useAuth } from '@/lib/auth';
import { useInboxItems, useMarkInboxRead } from '@/features/inbox/hooks';

const URGENT_PRIORITIES = new Set(['emergency', 'urgent']);
const MAX_URGENT_TOASTS = 3;
const PENDING_FLAG = 'hms.pendingLoginToast';

function consumePendingFlag() {
  try {
    if (sessionStorage.getItem(PENDING_FLAG) === '1') {
      sessionStorage.removeItem(PENDING_FLAG);
      return true;
    }
  } catch {
    // sessionStorage unavailable
  }
  return false;
}

function pickToastFn(priority) {
  if (URGENT_PRIORITIES.has(priority)) return toast.warning;
  return toast.info;
}

export default function LoginInboxToaster() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const markRead = useMarkInboxRead();

  const armedRef = useRef(null);
  if (armedRef.current === null) {
    armedRef.current = isAuthenticated ? consumePendingFlag() : false;
  }
  const armed = armedRef.current;

  const { data } = useInboxItems(
    { status: 'unread', page_size: 20 },
    { enabled: isAuthenticated && armed },
  );

  const firedRef = useRef(false);

  const items = useMemo(() => (Array.isArray(data?.results) ? data.results : []), [data]);
  const totalUnread = typeof data?.count === 'number' ? data.count : items.length;

  useEffect(() => {
    if (!armed || !data || firedRef.current) return;
    firedRef.current = true;

    if (items.length === 0) return;

    const urgent = items
      .filter((i) => URGENT_PRIORITIES.has(i.priority))
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
      .slice(0, MAX_URGENT_TOASTS);

    const handleView = (item) => () => {
      if (item.id) markRead.mutate(item.id);
      if (item.action_url) navigate(item.action_url);
      else navigate('/inbox');
    };

    urgent.forEach((item) => {
      const fn = pickToastFn(item.priority);
      fn(item.title, {
        duration: 10000,
        action: {
          label: 'View',
          onClick: handleView(item),
        },
      });
    });

    const urgentCount = items.filter((i) => URGENT_PRIORITIES.has(i.priority)).length;
    const summaryParts = [`${totalUnread} unread`];
    if (urgentCount > 0) summaryParts.push(`${urgentCount} urgent`);

    toast(summaryParts.join(' • '), {
      description: 'Open your inbox to review.',
      duration: 8000,
      action: {
        label: 'Open Inbox',
        onClick: () => navigate('/inbox'),
      },
    });
  }, [armed, data, items, totalUnread, markRead, navigate]);

  return null;
}
