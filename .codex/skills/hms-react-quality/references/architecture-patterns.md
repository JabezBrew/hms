# HMS React Architecture Patterns

## Feature Shape

Use this shape for new or substantially refactored frontend feature code:

```text
src/features/<domain>/
  api/
  hooks/
  components/
  pages/
  routes.js
  index.js
```

`src/pages/*` should be route wrappers only. Shared primitives belong in `src/shared/`.

## Page Split

Keep pages responsible for:

- Route params and navigation.
- Page title/breadcrumbs.
- Top-level query composition.
- `PageShell`, `PageHeader`, and `PageState`.

Extract:

- Tables and cards into `components/`.
- Mutations and list queries into `hooks/`.
- Fetch/normalize functions into `api/`.
- Reusable pure derivation into local utilities.

## Giant Component Extraction

Split a giant component when extraction improves one of:

- A workflow section can be understood independently.
- A form section has its own validation or mutation.
- A table/list has independent columns, filtering, pagination, or row actions.
- Expensive render work can be isolated or memoized.
- Tests can target a stable component boundary.

Do not split only to reduce line count if it scatters one coherent workflow across shallow files.

## Hook Pattern

Use hooks for behavior, not as dumping grounds:

```jsx
function useFeatureList(params) {
  return useQuery({
    queryKey: featureKeys.list(params),
    queryFn: ({ signal }) => featureApi.list(params, { signal }),
    placeholderData: keepPreviousData,
  })
}
```

Keep query params primitive and serializable. Memoize params only when identity matters to a child or effect.

## Mutation Pattern

```jsx
function useCreateFeatureItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: featureApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: featureKeys.lists() })
    },
  })
}
```

Invalidate the narrowest useful query family.

## Direct Imports

Prefer direct imports for heavy modules and large shared surfaces. Avoid broad barrels when they pull in unrelated components, charts, or workflow code.
