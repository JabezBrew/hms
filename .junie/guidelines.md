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

## DO NOTS
- Don't import react into any of the frontend code files. Instead, import the react functions from the react package.
For example, instead of importing React from 'react' to use React.useState in the code body, import {useState} from 'react'.

- Don't leave console.log statements in production code. They can cause performance issues and expose sensitive information. Use them only for debugging and remove them before committing code.

- Don't create function components that receive refs without using React.forwardRef. Function components cannot receive refs directly, so you must use forwardRef to properly forward refs to the underlying DOM elements or components. Example:
```jsx
// Incorrect
function MyComponent({ className, ...props }) {
  return <div className={className} {...props} />;
}

// Correct
const MyComponent = forwardRef(({ className, ...props }, ref) => {
  return <div ref={ref} className={className} {...props} />;
});
```
