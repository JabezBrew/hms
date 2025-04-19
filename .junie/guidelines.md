- For every phase of the project, make sure you follow the requirements and guidelines specified in these documentations: 

1. docs/frontend_design_specifications.md
2. docs/ui_component_design.md
3. docs/requirements.md

- At the end of every phase implementation, mark the completed tasks as done [x]. DON'T create any new doc till otherwise 
specified.

- When implementing the modules, make sure to implement a way to navigate to the module either from the sidebar or the 
drop-down menu in the top navigation bar.

- Utilize the shadcn ui components installed in src/components/ui instead of creating your own.

- For the sake of better SEO and navigation, ensure that detail pages and resources have dedicated endpoints. This means:
  - Each resource (patient, appointment, etc.) should have its own URL (e.g., `/patients/:id`, `/appointments/:id`)
  - Use proper routing (React Router) instead of managing detail views through component state
  - Implement proper navigation between list views and detail views
  - Ensure that refreshing a detail page maintains the context instead of redirecting to a list view
  - Make URLs bookmarkable and shareable

- Use the skeleton component (or a loader spinner when appropriate) when a screen is loading.

- When working with large datasets in dropdowns or select inputs, use searchable components like Combobox instead of simple Select components. This improves user experience and performance when dealing with many options:
  - Use the Combobox component for dropdowns with more than 20 items
  - Implement search functionality to filter options as the user types
  - Consider pagination or virtualization for extremely large datasets (1000+ items)
  - Always handle the case where the data might be empty or still loading
```jsx
// Example: Using Combobox for a large dataset
import { Combobox } from '@/components/ui/combobox';

// In your component
const options = largeDataset.map(item => ({
  label: item.name,
  value: item.id
}));

return (
  <Combobox
    options={options}
    value={selectedValue}
    onChange={handleChange}
    placeholder="Search and select an item..."
  />
);
```


## DO NOTS
- Don't import react into any of the frontend code files. Instead, import the react functions from the react package.
For example, instead of importing React from 'react' to use React.useState in the code body, import {useState} from 'react'.

- Don't leave console.log statements in production code. They can cause performance issues and expose sensitive information. Use them only for debugging and remove them before committing code.

- Don't create function components that receive refs without using React.forwardRef. Function components cannot receive refs directly, 
so you must use forwardRef to properly forward refs to the underlying DOM elements or components. This is especially important for UI components that might be used with libraries like Radix UI, which pass refs to components. Always add a displayName property to forwardRef components for better debugging. Example:
```jsx
// Incorrect
function MyComponent({ className, ...props }) {
  return <div className={className} {...props} />;
}

// Correct
const MyComponent = forwardRef(({ className, ...props }, ref) => {
  return <div ref={ref} className={className} {...props} />;
});
MyComponent.displayName = "MyComponent"; // Add displayName for better debugging
```

This applies to all components that might receive refs, including:
- Components that wrap DOM elements like inputs, buttons, etc.
- Components that wrap library components like Radix UI primitives
- Components that are used in contexts where refs might be passed to them (e.g., in forms, dialogs, etc.)

Failure to use forwardRef will result in React warnings like:
```
Warning: Function components cannot be given refs. Attempts to access this ref will fail. Did you mean to use React.forwardRef()?
```

- Don't assume API responses are always in the expected format. Always validate and handle different response structures, especially when working with paginated APIs. Use the apiClient's built-in pagination handling for GET requests, and add appropriate type checking before using array methods like .map(), .filter(), etc. Example:
```jsx
// Incorrect
const data = await apiClient.get('/endpoint');
const items = data.map(item => item.name); // This will fail if data is not an array

// Correct
const data = await apiClient.get('/endpoint'); // apiClient automatically handles pagination
// Additional safety check
const items = Array.isArray(data) ? data.map(item => item.name) : [];
```

- When working with dates in API requests and responses, be consistent with date formats. The backend expects dates in YYYY-MM-DD format for date fields. When sending dates from the frontend to the backend:
  - For date-only fields (without time), use YYYY-MM-DD format (e.g., "2025-04-17")
  - For datetime fields, use ISO-8601 format (e.g., "2025-04-17T00:00:00.000Z")
  - When displaying dates in the UI, format them according to the user's locale
  - When parsing dates from API responses, use appropriate date parsing libraries (like date-fns or dayjs)
```jsx
// Example: Formatting a date for an API request
import { format } from 'date-fns';

// For date-only fields
const formattedDate = format(new Date(), 'yyyy-MM-dd');

// For datetime fields
const isoDate = new Date().toISOString();
```

- When creating permissions, the correct way to combine permissions in Django REST Framework is to use the `|` (OR) operator between permission classes


Instead of this:
```python
permission_classes = [
    permissions.IsAuthenticated,
    permissions.OR(
        IsAdmin,
        IsDoctor,
        IsNurse
    )
]
```

DO this:
```python
permission_classes = [
    permissions.IsAuthenticated,
    IsAdmin | IsDoctor | IsNurse
]
```
