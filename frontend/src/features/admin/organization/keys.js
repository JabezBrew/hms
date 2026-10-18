export const organizationKeys = {
  all: scope => ['organization-directory', scope],
  page: (scope, query) => [...organizationKeys.all(scope), 'page', query],
};
