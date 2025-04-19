import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

/**
 * A component that restricts access to routes based on user roles.
 * 
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - The route content to render if authorized
 * @param {string[]} props.allowedRoles - Array of roles that are allowed to access this route
 * @param {string} [props.redirectTo='/unauthorized'] - Where to redirect if not authorized
 * @returns {React.ReactNode} The route content or a redirect
 */
export function RoleBasedRoute({ children, allowedRoles, redirectTo = '/unauthorized' }) {
  const { user, isAuthenticated } = useAuth();
  
  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  
  // If no roles specified or user role is in allowed roles, render children
  if (!allowedRoles || allowedRoles.length === 0 || allowedRoles.includes(user.role)) {
    return children;
  }
  
  // Otherwise redirect to unauthorized page
  return <Navigate to={redirectTo} />;
}