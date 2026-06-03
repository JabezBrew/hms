export function createReturnToLocation(location) {
  return {
    pathname: location?.pathname || '/',
    search: location?.search || '',
    hash: location?.hash || '',
    state: location?.state || {},
  };
}

export function navigateToReturnTo(navigate, location, fallbackPath) {
  const returnTo = location?.state?.returnTo;
  if (returnTo?.pathname) {
    navigate(
      {
        pathname: returnTo.pathname,
        search: returnTo.search || '',
        hash: returnTo.hash || '',
      },
      {
        state: returnTo.state || {},
        replace: true,
      }
    );
    return;
  }

  navigate(fallbackPath, { replace: true });
}
