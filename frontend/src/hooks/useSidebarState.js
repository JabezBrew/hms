import { useState, useCallback, useMemo } from 'react';
import { safeStorage } from '@/lib/safe-storage';

const SIDEBAR_STATE_KEY = 'sidebar_collapsed_state';

/**
 * Hook for managing sidebar collapsible menu states with localStorage persistence.
 *
 * Provides a generic/modular solution for tracking which sidebar menu items
 * are expanded or collapsed, persisting the state across page refreshes.
 *
 * @example
 * // In your sidebar component:
 * const { isOpen, toggle, setOpen } = useSidebarState();
 *
 * <Collapsible
 *   open={isOpen('inventory')}
 *   onOpenChange={(open) => setOpen('inventory', open)}
 * >
 *   ...
 * </Collapsible>
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.defaults - Default open states for menu items { menuKey: boolean }
 * @returns {Object} - Methods to manage sidebar state
 */
export function useSidebarState(options = {}) {
  const { defaults = {} } = options;

  // Initialize state from localStorage or defaults
  const [openStates, setOpenStates] = useState(() => {
    const stored = safeStorage.getJSON(SIDEBAR_STATE_KEY, null);
    if (stored && typeof stored === 'object') {
      // Merge stored with defaults (stored takes precedence)
      return { ...defaults, ...stored };
    }
    return defaults;
  });

  // Check if a specific menu is open
  const isOpen = useCallback((menuKey) => {
    return openStates[menuKey] ?? false;
  }, [openStates]);

  // Set the open state for a specific menu
  const setOpen = useCallback((menuKey, open) => {
    setOpenStates((prev) => {
      const next = { ...prev, [menuKey]: open };
      // Persist to localStorage
      safeStorage.setJSON(SIDEBAR_STATE_KEY, next);
      return next;
    });
  }, []);

  // Toggle a specific menu's open state
  const toggle = useCallback((menuKey) => {
    setOpenStates((prev) => {
      const next = { ...prev, [menuKey]: !prev[menuKey] };
      // Persist to localStorage
      safeStorage.setJSON(SIDEBAR_STATE_KEY, next);
      return next;
    });
  }, []);

  // Close all menus
  const closeAll = useCallback(() => {
    setOpenStates((prev) => {
      const next = Object.keys(prev).reduce((acc, key) => {
        acc[key] = false;
        return acc;
      }, {});
      safeStorage.setJSON(SIDEBAR_STATE_KEY, next);
      return next;
    });
  }, []);

  // Open all menus
  const openAll = useCallback(() => {
    setOpenStates((prev) => {
      const next = Object.keys(prev).reduce((acc, key) => {
        acc[key] = true;
        return acc;
      }, {});
      safeStorage.setJSON(SIDEBAR_STATE_KEY, next);
      return next;
    });
  }, []);

  // Get props for a Collapsible component
  const getCollapsibleProps = useCallback((menuKey) => ({
    open: openStates[menuKey] ?? false,
    onOpenChange: (open) => setOpen(menuKey, open),
  }), [openStates, setOpen]);

  return useMemo(() => ({
    isOpen,
    setOpen,
    toggle,
    closeAll,
    openAll,
    getCollapsibleProps,
    openStates,
  }), [isOpen, setOpen, toggle, closeAll, openAll, getCollapsibleProps, openStates]);
}

