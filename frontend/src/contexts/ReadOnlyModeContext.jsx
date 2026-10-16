import { createContext, useContext, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

const ReadOnlyModeContext = createContext(undefined);

/**
 * Provider for read-only mode state.
 *
 * Rust state is supplied by the authoritative network boundary. Legacy mode
 * retains its login access context. Provides:
 * - isReadOnly: Whether write operations should be disabled
 * - isOffsite: Whether user is accessing from outside the network
 * - readonlyMessage: Message to display to the user
 * - canWrite: Convenience function to check if user can perform writes
 */
export function ReadOnlyModeProvider({ children, network }) {
  const { user } = useAuth();

  const value = useMemo(() => {
    if (isRustV2ApiMode()) {
      const decision = network?.decision;
      const confirmed = network?.confirmed === true;
      const canRead = confirmed && decision?.access_allowed === true;
      const isReadOnly = !canRead || decision?.read_only !== false;
      return { isReadOnly, isOffsite: decision?.classification === 'offsite', offsiteMode: decision?.mode || null,
        readonlyMessage: decision?.reason === 'policy_unconfigured' ? 'Network policy is not configured. Workflow changes are unavailable.' : decision?.classification === 'unknown' ? 'This connection could not be verified. Workflow changes are unavailable.' : 'This connection has read-only access. Workflow changes are unavailable.',
        networkConfirmed: confirmed, networkDecision: decision, reauthRequired: decision?.reauth_required === true, requestReauthentication: network?.requestReauthentication,
        canRead, canWrite: () => canRead && !isReadOnly,
        canPerformAction: (action) => ['view', 'read', 'list', 'search'].includes(action) ? canRead : canRead && !isReadOnly };
    }
    // Get access context from user data (set during login)
    const accessContext = user?.accessContext;

    // Default to allowing writes if no access context
    const isOffsite = accessContext?.is_offsite ?? false;
    const offsiteMode = accessContext?.offsite_mode ?? 'allow';
    const readonlyMessage = accessContext?.readonly_message ?? null;

    // User is in read-only mode if off-site and mode is 'readonly'
    const isReadOnly = isOffsite && offsiteMode === 'readonly';

    return {
      // Core state
      isReadOnly,
      isOffsite,
      offsiteMode,
      readonlyMessage,

      // Convenience function for checking write permission
      canWrite: () => !isReadOnly,

      // Check if a specific action type is allowed
      canPerformAction: (actionType) => {
        // All read actions are always allowed
        if (['view', 'read', 'list', 'search'].includes(actionType)) {
          return true;
        }
        // Write actions are blocked in read-only mode
        return !isReadOnly;
      },

      // For debugging/admin visibility
      userData: {
        isOffsite,
        offsiteMode,
        hasReadonlyMessage: !!readonlyMessage,
      },
    };
  }, [user?.accessContext, network]);

  return (
    <ReadOnlyModeContext.Provider value={value}>
      {children}
    </ReadOnlyModeContext.Provider>
  );
}

/**
 * Hook to access read-only mode state.
 *
 * @example
 * const { isReadOnly, canWrite, readonlyMessage } = useReadOnlyMode();
 *
 * if (!canWrite()) {
 *   return <span>Cannot edit in read-only mode</span>;
 * }
 */
export function useReadOnlyMode({ optional = false } = {}) {
  const context = useContext(ReadOnlyModeContext);
  if (context === undefined && !optional) {
    throw new Error('useReadOnlyMode must be used within a ReadOnlyModeProvider');
  }
  return context;
}
