import { createContext, useContext, useMemo } from 'react';
import { useAuth } from '@/lib/auth';

const ReadOnlyModeContext = createContext(undefined);

/**
 * Provider for read-only mode state.
 *
 * Uses access context from login response to detect when user is accessing
 * from off-site and provides:
 * - isReadOnly: Whether write operations should be disabled
 * - isOffsite: Whether user is accessing from outside the network
 * - readonlyMessage: Message to display to the user
 * - canWrite: Convenience function to check if user can perform writes
 */
export function ReadOnlyModeProvider({ children }) {
  const { user } = useAuth();

  const value = useMemo(() => {
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
  }, [user?.accessContext]);

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
export function useReadOnlyMode() {
  const context = useContext(ReadOnlyModeContext);
  if (context === undefined) {
    throw new Error('useReadOnlyMode must be used within a ReadOnlyModeProvider');
  }
  return context;
}

/**
 * Higher-order component that disables a component in read-only mode.
 *
 * @example
 * const SaveButton = withReadOnlyGuard(Button, {
 *   disabledMessage: "Cannot save while off-site"
 * });
 */
export function withReadOnlyGuard(WrappedComponent, options = {}) {
  const { disabledMessage = "Read-only mode" } = options;

  return function ReadOnlyGuardedComponent(props) {
    const { isReadOnly, readonlyMessage } = useReadOnlyMode();

    if (isReadOnly) {
      return (
        <WrappedComponent
          {...props}
          disabled
          title={disabledMessage || readonlyMessage}
        />
      );
    }

    return <WrappedComponent {...props} />;
  };
}
