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
import { useEffect, createContext, useContext, useState, useCallback, useRef } from 'react';

// Create a context for breadcrumb state
const BreadcrumbContext = createContext();

// Provider component for breadcrumb context
export function BreadcrumbProvider({ children }) {
  const [breadcrumbs, setBreadcrumbs] = useState([
    { label: 'Home', path: '/' }
  ]);
  const location = useLocation();
  const lastPathRef = useRef(location.pathname);

  const updateBreadcrumbs = useCallback((newBreadcrumbs) => {
    // Filter out any "Home" breadcrumbs from the input (we add it automatically)
    const filteredBreadcrumbs = newBreadcrumbs.filter(
      crumb => crumb.label !== 'Home' && crumb.path !== '/'
    );

    setBreadcrumbs([
      { label: 'Home', path: '/' },
      ...filteredBreadcrumbs
    ]);
  }, []);

  // Reset breadcrumbs when navigating to a new route
  useEffect(() => {
    if (location.pathname !== lastPathRef.current) {
      lastPathRef.current = location.pathname;
      // Reset to just Home when route changes
      setBreadcrumbs([{ label: 'Home', path: '/' }]);
    }
  }, [location.pathname]);

  return (
    <BreadcrumbContext.Provider value={{ breadcrumbs, updateBreadcrumbs }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

// Hook to use breadcrumb context
export function useBreadcrumb() {
  const context = useContext(BreadcrumbContext);
  if (!context) {
    throw new Error('useBreadcrumb must be used within a BreadcrumbProvider');
  }
  return context;
}

// Component to set breadcrumbs for a page
export function BreadcrumbSetter({ breadcrumbs }) {
  const { updateBreadcrumbs } = useBreadcrumb();

  useEffect(() => {
    if (breadcrumbs && breadcrumbs.length > 0) {
      updateBreadcrumbs(breadcrumbs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breadcrumbs]);

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
                {isLast ? (
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
