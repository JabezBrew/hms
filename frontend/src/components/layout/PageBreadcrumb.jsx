import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage
} from '@/components/ui/breadcrumb';
import { useEffect, createContext, useContext, useState, useCallback, useMemo, useRef } from 'react';

// Create a context for breadcrumb state
const BreadcrumbContext = createContext();

// Provider component for breadcrumb context
export function BreadcrumbProvider({ children }) {
  const [breadcrumbs, setBreadcrumbs] = useState([
    { label: 'Home', path: '/' }
  ]);
  const { pathname } = useLocation();
  const lastPathRef = useRef(pathname);
  const lastAppliedPathRef = useRef(pathname);

  const updateBreadcrumbs = useCallback((newBreadcrumbs, appliedPath) => {
    const safeBreadcrumbs = Array.isArray(newBreadcrumbs) ? newBreadcrumbs : [];
    const normalizedBreadcrumbs = safeBreadcrumbs.map((crumb) => ({
      ...crumb,
      path: crumb.path || crumb.href,
    }));
    // Filter out any "Home" breadcrumbs from the input (we add it automatically)
    const filteredBreadcrumbs = normalizedBreadcrumbs.filter(
      crumb => crumb.label !== 'Home' && crumb.path !== '/'
    );

    lastAppliedPathRef.current = appliedPath || lastAppliedPathRef.current;
    setBreadcrumbs([
      { label: 'Home', path: '/' },
      ...filteredBreadcrumbs
    ]);
  }, []);

  // Reset breadcrumbs when navigating to a new route
  useEffect(() => {
    if (pathname !== lastPathRef.current) {
      lastPathRef.current = pathname;
      // Skip reset if breadcrumbs were already applied for this path.
      if (lastAppliedPathRef.current === pathname) {
        return;
      }
      // Reset to just Home when route changes
      setBreadcrumbs([{ label: 'Home', path: '/' }]);
    }
  }, [pathname]);

  const contextValue = useMemo(() => ({ breadcrumbs, updateBreadcrumbs }), [breadcrumbs, updateBreadcrumbs]);

  return (
    <BreadcrumbContext.Provider value={contextValue}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

// Hook to use breadcrumb context
function useBreadcrumb() {
  const context = useContext(BreadcrumbContext);
  if (!context) {
    throw new Error('useBreadcrumb must be used within a BreadcrumbProvider');
  }
  return context;
}

// Component to set breadcrumbs for a page
export function BreadcrumbSetter({ breadcrumbs }) {
  const { pathname } = useLocation();
  const { updateBreadcrumbs } = useBreadcrumb();

  useEffect(() => {
    updateBreadcrumbs(breadcrumbs, pathname);
  }, [breadcrumbs, pathname, updateBreadcrumbs]);

  return null;
}

// Main breadcrumb component
export function PageBreadcrumb() {
  const { breadcrumbs } = useBreadcrumb();

  if (breadcrumbs.length <= 1) {
    return null; // Don't show breadcrumb if only home is present
  }

  return (
    <Breadcrumb aria-label="breadcrumb" className="mb-4">
      <BreadcrumbList>
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;

          return (
            <React.Fragment key={index}>
              <BreadcrumbItem>
                {isLast || !crumb.path ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.path}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>

              {!isLast && <BreadcrumbSeparator />}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
