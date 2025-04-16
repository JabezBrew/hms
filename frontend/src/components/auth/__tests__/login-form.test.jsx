import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginForm } from '../login-form';
import { useAuth } from '../../../lib/auth';
import { notifications } from '../../../lib/notifications';

// Mock the auth hook
jest.mock('../../../lib/auth', () => ({
  useAuth: jest.fn(),
}));

// Mock the notifications utility
jest.mock('../../../lib/notifications', () => ({
  notifications: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock window.location
const originalLocation = window.location;
beforeAll(() => {
  delete window.location;
  window.location = { href: '' };
});
afterAll(() => {
  window.location = originalLocation;
});

describe('LoginForm', () => {
  const mockLogin = jest.fn();
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock the useAuth hook
    useAuth.mockReturnValue({
      login: mockLogin,
    });
  });
  
  it('renders the login form correctly', () => {
    render(<LoginForm />);
    
    // Check that the form elements are rendered
    expect(screen.getByText('Login to your account')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
    expect(screen.getByText('Forgot password?')).toBeInTheDocument();
    expect(screen.getByText('Register')).toBeInTheDocument();
  });
  
  it('submits the form with email and password', async () => {
    render(<LoginForm />);
    
    // Fill in the form
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    
    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    
    // Check that login was called with the correct arguments
    expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    
    // Wait for the success notification and redirect
    await waitFor(() => {
      expect(notifications.success).toHaveBeenCalledWith('Logged in successfully');
      expect(window.location.href).toBe('/');
    });
  });
  
  it('handles login failure', async () => {
    // Mock login to throw an error
    mockLogin.mockRejectedValue(new Error('Invalid credentials'));
    
    render(<LoginForm />);
    
    // Fill in the form
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong-password' },
    });
    
    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    
    // Check that login was called
    expect(mockLogin).toHaveBeenCalled();
    
    // Wait for the form to be enabled again after error
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Login' })).not.toBeDisabled();
    });
  });
  
  it('disables the form during submission', async () => {
    // Mock login to return a promise that doesn't resolve immediately
    mockLogin.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve({ id: 1, name: 'Test User' }), 100);
    }));
    
    render(<LoginForm />);
    
    // Fill in the form
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    
    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    
    // Check that the button is disabled during submission
    expect(screen.getByRole('button', { name: 'Login' })).toBeDisabled();
    
    // Wait for the form to be enabled again
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Login' })).not.toBeDisabled();
    });
  });
});