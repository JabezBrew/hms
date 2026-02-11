import { useState, useCallback, useRef, useEffect } from 'react';
import { useSidebar } from '@/components/ui/sidebar';

/**
 * useSlideOver - Hook for managing slide-over panels with automatic sidebar collapse
 *
 * When a slide-over opens, the sidebar automatically collapses to give more room.
 * When the slide-over closes, the sidebar is restored to its previous state.
 *
 * @param {boolean} initialState - Initial open state (default: false)
 * @returns {[boolean, Function, Function]} - [isOpen, open, close]
 *
 * @example
 * const [isNoteOpen, openNote, closeNote] = useSlideOver();
 *
 * // Open the slide-over (sidebar will collapse)
 * <Button onClick={openNote}>Add Note</Button>
 *
 * // In your slide-over component
 * <NoteForm open={isNoteOpen} onClose={closeNote} />
 */
export function useSlideOver(initialState = false) {
  const [isOpen, setIsOpen] = useState(initialState);
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const previousSidebarState = useRef(sidebarOpen);
  const sidebarOpenRef = useRef(sidebarOpen);

  // Keep the ref updated with the current sidebar state
  useEffect(() => {
    sidebarOpenRef.current = sidebarOpen;
  }, [sidebarOpen]);

  const open = useCallback(() => {
    // Store the current sidebar state before collapsing (using ref for latest value)
    previousSidebarState.current = sidebarOpenRef.current;
    // Collapse the sidebar
    setSidebarOpen(false);
    // Open the slide-over
    setIsOpen(true);
  }, [setSidebarOpen]);

  const close = useCallback(() => {
    // Close the slide-over
    setIsOpen(false);
    // Restore the sidebar to its previous state
    setSidebarOpen(previousSidebarState.current);
  }, [setSidebarOpen]);

  return [isOpen, open, close];
}

/**
 * useMultipleSlideOvers - Hook for managing multiple slide-over panels
 *
 * Useful when a page has multiple slide-overs (e.g., notes, vitals, prescriptions).
 * Only one slide-over can be open at a time. Sidebar collapses when any opens.
 *
 * @param {string[]} slideOverNames - Array of slide-over names
 * @returns {Object} - { activeSlideOver, open, close, isOpen }
 *
 * @example
 * const slideOvers = useMultipleSlideOvers(['note', 'vitals', 'prescription', 'labs', 'referral']);
 *
 * // Check if a specific slide-over is open
 * slideOvers.isOpen('note') // true/false
 *
 * // Open a specific slide-over
 * <Button onClick={() => slideOvers.open('note')}>Add Note</Button>
 *
 * // Close the active slide-over
 * <NoteForm open={slideOvers.isOpen('note')} onClose={slideOvers.close} />
 */
export function useMultipleSlideOvers(slideOverNames = []) {
  const [activeSlideOver, setActiveSlideOver] = useState(null);
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const previousSidebarState = useRef(sidebarOpen);
  const sidebarOpenRef = useRef(sidebarOpen);

  // Keep the ref updated with the current sidebar state
  useEffect(() => {
    sidebarOpenRef.current = sidebarOpen;
  }, [sidebarOpen]);

  const open = useCallback((name) => {
    if (!slideOverNames.includes(name)) {
      console.warn(`Unknown slide-over: ${name}. Available: ${slideOverNames.join(', ')}`);
      return;
    }
    // Store the current sidebar state before collapsing (only if no slide-over is currently open)
    setActiveSlideOver((prev) => {
      if (!prev) {
        previousSidebarState.current = sidebarOpenRef.current;
      }
      return name;
    });
    // Collapse the sidebar
    setSidebarOpen(false);
  }, [slideOverNames, setSidebarOpen]);

  const close = useCallback(() => {
    // Close the slide-over
    setActiveSlideOver(null);
    // Restore the sidebar to its previous state
    setSidebarOpen(previousSidebarState.current);
  }, [setSidebarOpen]);

  const isOpen = useCallback((name) => {
    return activeSlideOver === name;
  }, [activeSlideOver]);

  return {
    activeSlideOver,
    open,
    close,
    isOpen,
  };
}

export default useSlideOver;
