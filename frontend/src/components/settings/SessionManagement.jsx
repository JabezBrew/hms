import { useMemo } from 'react';
import { toast } from 'sonner';
import Monitor from 'lucide-react/dist/esm/icons/monitor.js';
import Smartphone from 'lucide-react/dist/esm/icons/smartphone.js';
import Globe from 'lucide-react/dist/esm/icons/globe.js';
import LogOut from 'lucide-react/dist/esm/icons/log-out.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { format, formatDistanceToNow } from 'date-fns';

import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useUserSessions, useRevokeSession, useRevokeAllSessions } from '@/features/settings/hooks';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/**
 * SessionManagement - Chronicle-styled session list with management
 */
export default function SessionManagement() {
  const { logout } = useAuth();
  const { data: sessionsData, isLoading, isError, refetch } = useUserSessions();
  const revokeSession = useRevokeSession();
  const revokeAllSessions = useRevokeAllSessions();

  // Handle paginated response
  const sessions = useMemo(() => {
    if (!sessionsData) return [];
    if (sessionsData.results) return sessionsData.results;
    if (Array.isArray(sessionsData)) return sessionsData;
    return [];
  }, [sessionsData]);

  const handleRevokeSession = async (sessionId, isCurrent = false) => {
    try {
      await revokeSession.mutateAsync(sessionId);
      if (isCurrent) {
        // Revoking current session = logout
        toast.success('Session ended. Redirecting to login...');
        setTimeout(() => logout(), 500);
      } else {
        toast.success('Session revoked');
      }
    } catch (error) {
      toast.error(error.message || 'Failed to revoke session');
    }
  };

  const handleRevokeAll = async () => {
    try {
      await revokeAllSessions.mutateAsync(true);
      toast.success('All other sessions revoked');
    } catch (error) {
      toast.error(error.message || 'Failed to revoke sessions');
    }
  };

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (isError) {
    return (
      <div className="text-center py-8 bg-muted/30 border border-border rounded-xl">
        <p className="text-muted-foreground mb-4 text-sm">Failed to load sessions</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="font-mono text-xs">
          <RefreshCw className="size-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="text-center py-8 bg-muted/30 border border-border rounded-xl">
        <Globe className="size-12 mx-auto text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground text-sm">No active sessions found</p>
      </div>
    );
  }

  // Count non-current sessions
  const otherSessionsCount = sessions.filter(s => !s.is_current).length;

  return (
    <div className="space-y-4">
      {/* Revoke All Button */}
      {otherSessionsCount > 0 && (
        <div className="flex justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-rose-400 border-rose-400/30 hover:text-rose-300 hover:bg-rose-500/10 font-mono text-xs"
                disabled={revokeAllSessions.isPending}
              >
                <LogOut className="size-4 mr-2" />
                Sign Out All Other Sessions
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display">Sign out all other sessions?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will sign you out of all other devices and browsers. Your current session will remain active.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleRevokeAll}
                  className="bg-rose-500 text-white hover:bg-rose-600 font-mono text-xs"
                >
                  Sign Out All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* Sessions List */}
      <div className="space-y-3">
        {sessions.map((session, index) => (
          <SessionCard
            key={session.id}
            session={session}
            index={index}
            onRevoke={() => handleRevokeSession(session.id, session.is_current)}
            isRevoking={revokeSession.isPending}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * SessionCard - Chronicle-styled individual session with full details
 */
function SessionCard({ session, index, onRevoke, isRevoking }) {
  const deviceLabel = session.device_label || 'Unknown device';
  const deviceIcon = getDeviceIcon(session.device_label);
  const DeviceIcon = deviceIcon;

  return (
    <div
      className={cn(
        'flex items-start gap-4 p-4 rounded-xl border transition-all animate-chronicle-enter',
        session.is_current
          ? 'bg-emerald-500/5 border-emerald-500/20'
          : 'bg-card border-border hover:border-border/80'
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Device Icon */}
      <div className={cn(
        'p-2.5 rounded-lg shrink-0',
        session.is_current
          ? 'bg-emerald-500/10 border border-emerald-500/20'
          : 'bg-muted/50 border border-border'
      )}>
        <DeviceIcon
          className={cn(
            'size-5',
            session.is_current ? 'text-emerald-400' : 'text-muted-foreground'
          )}
          aria-hidden="true"
        />
      </div>

      {/* Session Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="font-display text-sm font-medium text-foreground truncate">
            {deviceLabel}
          </span>
          {session.is_current && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Shield className="size-2.5" />
              Current
            </span>
          )}
        </div>

        {/* Location & IP */}
        <div className="space-y-1">
          {(session.location || session.ip_address) && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="size-3 shrink-0" />
              <span className="font-mono text-[11px]">
                {session.location || 'Unknown location'}
                {session.ip_address && (
                  <span className="text-muted-foreground/60 ml-1.5">
                    ({session.ip_address})
                  </span>
                )}
              </span>
            </div>
          )}

          {/* Created At */}
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="size-3 shrink-0" />
            <span className="font-mono text-[11px]">
              Signed in{' '}
              {session.created_at
                ? format(new Date(session.created_at), "MMM d, yyyy 'at' h:mm a")
                : 'unknown'}
            </span>
          </div>

          {/* Last Activity - only show for non-current sessions */}
          {!session.is_current && (
            <p className="font-mono text-[11px] text-muted-foreground/70 pl-[18px]">
              Last activity{' '}
              {session.last_seen_at
                ? formatDistanceToNow(new Date(session.last_seen_at), { addSuffix: true })
                : 'unknown'}
            </p>
          )}
        </div>
      </div>

      {/* Revoke Button */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'shrink-0',
              session.is_current
                ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
                : 'text-rose-400 hover:text-rose-300 hover:bg-rose-500/10'
            )}
            disabled={isRevoking}
          >
            <LogOut className="size-4" />
            <span className="sr-only">Sign out this session</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display flex items-center gap-2">
              {session.is_current && (
                <AlertTriangle className="size-5 text-amber-400" />
              )}
              {session.is_current ? 'End current session?' : 'Sign out this session?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {session.is_current ? (
                <span className="text-amber-400/90">
                  This will log you out immediately. You will need to sign in again to access the application.
                </span>
              ) : (
                'This will sign you out of this device. You will need to sign in again on that device.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onRevoke}
              className={cn(
                'font-mono text-xs text-white',
                session.is_current
                  ? 'bg-amber-500 hover:bg-amber-600'
                  : 'bg-rose-500 hover:bg-rose-600'
              )}
            >
              {session.is_current ? 'Log Out Now' : 'Sign Out'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Get appropriate device icon based on device label
 */
function getDeviceIcon(deviceLabel) {
  const value = (deviceLabel || '').toLowerCase();
  if (!value) return Globe;
  if (value.includes('mobile') || value.includes('android') || value.includes('iphone') || value.includes('ios')) {
    return Smartphone;
  }
  return Monitor;
}

/**
 * Get device name from user agent string or device label
 * @deprecated - device_label now comes from backend
 */
function getDeviceName(userAgent) {
  if (!userAgent) return 'Unknown Device';

  // If it's a simple device label (not a full user agent string), return as-is
  if (!userAgent.includes('/') && !userAgent.includes('Mozilla')) {
    return userAgent;
  }

  const ua = userAgent.toLowerCase();

  // Browser detection
  let browser = 'Browser';
  if (ua.includes('chrome') && !ua.includes('edge')) browser = 'Chrome';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('edge')) browser = 'Edge';

  // OS detection
  let os = '';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';

  return os ? `${browser} on ${os}` : browser;
}

/**
 * LoadingSkeleton - Chronicle styled
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}
