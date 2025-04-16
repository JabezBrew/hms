import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../theme-provider';

// Test component that uses the useTheme hook
function TestComponent() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <div data-testid="theme-value">{theme}</div>
      <button data-testid="toggle-button" onClick={toggleTheme}>
        Toggle Theme
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    
    // Mock document.documentElement
    Object.defineProperty(document, 'documentElement', {
      writable: true,
      value: {
        classList: {
          add: jest.fn(),
          remove: jest.fn(),
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
    expect(localStorage.getItem('theme')).toBe('dark');
    
    // Toggle back to light
    fireEvent.click(screen.getByTestId('toggle-button'));
    
    // Check localStorage again
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('uses the theme from localStorage if available', () => {
    // Set theme in localStorage
    localStorage.setItem('theme', 'dark');
    
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );
    
    // Theme should be dark
    expect(screen.getByTestId('theme-value').textContent).toBe('dark');
  });
});