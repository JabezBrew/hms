import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';
import { ThemeProvider, useTheme } from '../theme-provider';
import { safeStorage } from '@/lib/safe-storage';

// Test component that uses the useTheme hook
function TestComponent() {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
  return (
    <div>
      <div data-testid="theme-value">{theme}</div>
      <div data-testid="resolved-theme">{resolvedTheme}</div>
      <button onClick={() => setTheme('system')}>Use device theme</button>
      <button onClick={() => setTheme('invalid')}>Invalid theme</button>
      <button data-testid="toggle-button" onClick={toggleTheme}>
        Toggle Theme
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  let media;
  let listeners;
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    listeners = new Set();
    media = {
      matches: false,
      addEventListener: vi.fn((_event, callback) => listeners.add(callback)),
      removeEventListener: vi.fn((_event, callback) => listeners.delete(callback)),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    
    // Mock document.documentElement
    Object.defineProperty(document, 'documentElement', {
      writable: true,
      value: {
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
        },
      },
    });
  });

  it('provides the default theme (light)', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );
    
    expect(screen.getByTestId('theme-value').textContent).toBe('light');
  });

  it('toggles the theme when toggleTheme is called', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );
    
    // Initial theme should be light
    expect(screen.getByTestId('theme-value').textContent).toBe('light');
    
    // Toggle the theme
    fireEvent.click(screen.getByTestId('toggle-button'));
    
    // Theme should now be dark
    expect(screen.getByTestId('theme-value').textContent).toBe('dark');
    
    // Toggle again
    fireEvent.click(screen.getByTestId('toggle-button'));
    
    // Theme should be back to light
    expect(screen.getByTestId('theme-value').textContent).toBe('light');
  });

  it('persists the theme in localStorage', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );
    
    // Toggle the theme to dark
    fireEvent.click(screen.getByTestId('toggle-button'));
    
    // Check localStorage
    expect(safeStorage.get('theme')).toBe('dark');
    
    // Toggle back to light
    fireEvent.click(screen.getByTestId('toggle-button'));
    
    // Check localStorage again
    expect(safeStorage.get('theme')).toBe('light');
  });

  it('uses the theme from localStorage if available', () => {
    // Set theme in localStorage
    safeStorage.set('theme', 'dark');
    
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );
    
    // Theme should be dark
    expect(screen.getByTestId('theme-value').textContent).toBe('dark');
  });

  it('follows device changes only while system appearance is selected', () => {
    const { unmount } = render(<ThemeProvider><TestComponent /></ThemeProvider>);
    fireEvent.click(screen.getByText('Use device theme'));
    expect(safeStorage.get('theme')).toBe('system');
    expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light');
    act(() => {
      media.matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark');
    expect(document.documentElement.classList.add).toHaveBeenLastCalledWith('dark');
    fireEvent.click(screen.getByTestId('toggle-button'));
    expect(screen.getByTestId('theme-value')).toHaveTextContent('light');
    expect(listeners.size).toBe(0);
    unmount();
    expect(media.removeEventListener).toHaveBeenCalled();
  });

  it('restores a saved system preference and rejects invalid values', () => {
    safeStorage.set('theme', 'system');
    media.matches = true;
    render(<ThemeProvider><TestComponent /></ThemeProvider>);
    expect(screen.getByTestId('theme-value')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark');
    fireEvent.click(screen.getByText('Invalid theme'));
    expect(screen.getByTestId('theme-value')).toHaveTextContent('system');
  });

  it('recovers from an invalid stored preference', () => {
    safeStorage.set('theme', 'broken class');
    render(<ThemeProvider><TestComponent /></ThemeProvider>);
    expect(screen.getByTestId('theme-value')).toHaveTextContent('light');
    expect(safeStorage.get('theme')).toBe('light');
  });
});
