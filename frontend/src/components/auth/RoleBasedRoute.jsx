import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { userCanAccess } from '@/shared/lib/access';

/**
 * A component that restricts access to routes based on user roles.
 * 
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - The route content to render if authorized
 * @param {string[]} props.allowedRoles - Array of roles that are allowed to access this route
 * @param {string[]} props.allowedCapabilities - Array of admin capabilities that are allowed to access this route
 * @param {string} [props.redirectTo='/unauthorized'] - Where to redirect if not authorized
 * @returns {React.ReactNode} The route content or a redirect
 */
export function RoleBasedRoute({ children, allowedRoles, allowedCapabilities, redirectTo = '/unauthorized' }) {
  const { user, isAuthenticated } = useAuth();
  
  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  
  // If no access restrictions are specified, or the user has an allowed role/capability, render children.
  if (userCanAccess(user, { roles: allowedRoles, capabilities: allowedCapabilities })) {
    return children;
  }
  
  // Otherwise redirect to unauthorized page
  return <Navigate to={redirectTo} />;
}
