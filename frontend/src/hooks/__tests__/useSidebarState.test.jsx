import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSidebarState } from '../useSidebarState';

// Mock safeStorage
vi.mock('@/lib/safe-storage', () => ({
  safeStorage: {
    getJSON: vi.fn(() => null),
    setJSON: vi.fn(() => true),
  },
}));

import { safeStorage } from '@/lib/safe-storage';

describe('useSidebarState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default closed state when no stored value', () => {
    safeStorage.getJSON.mockReturnValue(null);

    const { result } = renderHook(() => useSidebarState());

    expect(result.current.isOpen('inventory')).toBe(false);
    expect(result.current.isOpen('settings')).toBe(false);
  });

  it('initializes with provided defaults', () => {
    safeStorage.getJSON.mockReturnValue(null);

    const { result } = renderHook(() =>
      useSidebarState({ defaults: { inventory: true, settings: false } })
    );

    expect(result.current.isOpen('inventory')).toBe(true);
    expect(result.current.isOpen('settings')).toBe(false);
  });

  it('loads stored state from localStorage', () => {
    safeStorage.getJSON.mockReturnValue({ inventory: true, reports: true });

    const { result } = renderHook(() => useSidebarState());

    expect(result.current.isOpen('inventory')).toBe(true);
    expect(result.current.isOpen('reports')).toBe(true);
  });

  it('merges stored state with defaults (stored takes precedence)', () => {
    safeStorage.getJSON.mockReturnValue({ inventory: true });

    const { result } = renderHook(() =>
      useSidebarState({ defaults: { inventory: false, settings: true } })
    );

    // Stored value overrides default
    expect(result.current.isOpen('inventory')).toBe(true);
    // Default is preserved when not in stored
    expect(result.current.isOpen('settings')).toBe(true);
  });

  it('setOpen updates state and persists to localStorage', () => {
    safeStorage.getJSON.mockReturnValue(null);

    const { result } = renderHook(() => useSidebarState());

    act(() => {
      result.current.setOpen('inventory', true);
    });

    expect(result.current.isOpen('inventory')).toBe(true);
    expect(safeStorage.setJSON).toHaveBeenCalledWith(
      'sidebar_collapsed_state',
      expect.objectContaining({ inventory: true })
    );
  });

  it('toggle flips the open state', () => {
    safeStorage.getJSON.mockReturnValue({ inventory: false });

    const { result } = renderHook(() => useSidebarState());

    expect(result.current.isOpen('inventory')).toBe(false);

    act(() => {
      result.current.toggle('inventory');
    });

    expect(result.current.isOpen('inventory')).toBe(true);

    act(() => {
      result.current.toggle('inventory');
    });

    expect(result.current.isOpen('inventory')).toBe(false);
  });

  it('closeAll closes all menus', () => {
    safeStorage.getJSON.mockReturnValue({ inventory: true, settings: true, reports: true });

    const { result } = renderHook(() => useSidebarState());

    act(() => {
      result.current.closeAll();
    });

    expect(result.current.isOpen('inventory')).toBe(false);
    expect(result.current.isOpen('settings')).toBe(false);
    expect(result.current.isOpen('reports')).toBe(false);
  });

  it('openAll opens all menus', () => {
    safeStorage.getJSON.mockReturnValue({ inventory: false, settings: false });

    const { result } = renderHook(() => useSidebarState());

    act(() => {
      result.current.openAll();
    });

    expect(result.current.isOpen('inventory')).toBe(true);
    expect(result.current.isOpen('settings')).toBe(true);
  });

  it('getCollapsibleProps returns open and onOpenChange', () => {
    safeStorage.getJSON.mockReturnValue({ inventory: true });

    const { result } = renderHook(() => useSidebarState());

    const props = result.current.getCollapsibleProps('inventory');

    expect(props.open).toBe(true);
    expect(typeof props.onOpenChange).toBe('function');

    // Test onOpenChange updates state
    act(() => {
      props.onOpenChange(false);
    });

    expect(result.current.isOpen('inventory')).toBe(false);
  });

  it('exposes openStates object', () => {
    safeStorage.getJSON.mockReturnValue({ inventory: true, settings: false });

    const { result } = renderHook(() => useSidebarState());

    expect(result.current.openStates).toEqual({ inventory: true, settings: false });
  });
});
