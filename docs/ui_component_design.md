# Hospital Management System - UI Component Design

## Design System Overview

The Hospital Management System (HMS) frontend will follow a modern, clean, and accessible design system that prioritizes usability across different devices while maintaining a professional healthcare aesthetic.

### Design Principles

1. **Clarity** - Information presented clearly with proper hierarchy
2. **Efficiency** - Minimize clicks and optimize workflows for frequent tasks
3. **Consistency** - Uniform patterns and behaviors across the application
4. **Accessibility** - WCAG 2.1 AA compliance for all users
5. **Responsiveness** - Seamless experience across devices

### Color Palette

#### Primary Colors
- **Primary Blue** (#1976D2): Main brand color, used for primary actions and key UI elements
- **Secondary Teal** (#00ACC1): Used for secondary actions and accents
- **Tertiary Green** (#43A047): Used for success states and positive indicators

#### Neutral Colors
- **Dark Gray** (#333333): Used for primary text
- **Medium Gray** (#757575): Used for secondary text
- **Light Gray** (#E0E0E0): Used for borders and dividers
- **Background Gray** (#F5F5F5): Used for page backgrounds
- **White** (#FFFFFF): Used for card backgrounds and contrast

#### Semantic Colors
- **Success** (#4CAF50): Indicates successful actions or positive status
- **Warning** (#FF9800): Indicates warnings or caution
- **Error** (#F44336): Indicates errors or critical issues
- **Info** (#2196F3): Indicates informational messages

### Typography

- **Primary Font**: Inter (sans-serif)
- **Secondary Font**: Roboto (sans-serif)
- **Fallback Fonts**: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif

#### Font Sizes
- Heading 1: 24px (mobile) / 32px (desktop)
- Heading 2: 20px (mobile) / 24px (desktop)
- Heading 3: 18px (mobile) / 20px (desktop)
- Body: 14px (mobile) / 16px (desktop)
- Small: 12px (mobile) / 14px (desktop)

### Spacing System

Using an 8px grid system:
- 4px - Extra small spacing (xs)
- 8px - Small spacing (sm)
- 16px - Medium spacing (md)
- 24px - Large spacing (lg)
- 32px - Extra large spacing (xl)
- 48px - 2x extra large spacing (2xl)

## Common Layout Structure

### Global Layout

The HMS will use a responsive layout with the following components:

1. **Top Navigation Bar**
   - Logo/Brand
   - Global search
   - Notifications
   - User profile menu
   - Help/support access

2. **Side Navigation (Desktop)**
   - Role-based navigation menu
   - Collapsible for more screen space
   - Visual indicators for current section

3. **Bottom Navigation (Mobile)**
   - Simplified navigation for key functions
   - Home, Search, Notifications, Menu

4. **Main Content Area**
   - Breadcrumb navigation
   - Page title and actions
   - Content cards/sections
   - Responsive grid layout

5. **Footer**
   - Copyright information
   - Version number
   - Quick links to policies/help

### Role-Specific Dashboard Layouts

Each user role will have a customized dashboard layout focusing on their primary tasks:

1. **Front Desk Dashboard**
   - Quick patient search
   - Today's appointments overview
   - Check-in queue
   - Recent patients
   - Quick actions (register patient, schedule appointment)

2. **Doctor Dashboard**
   - Today's appointments
   - Pending tasks (lab results, prescriptions)
   - Recent patients
   - Quick actions (start encounter, view schedule)

3. **Lab Technician Dashboard**
   - Pending lab orders
   - Recently completed tests
   - Work queue
   - Quick actions (enter results, view patient)

4. **Pharmacist Dashboard**
   - Pending prescriptions
   - Low stock alerts
   - Recently dispensed medications
   - Quick actions (dispense medication, check inventory)

5. **Billing Clerk Dashboard**
   - Pending invoices
   - Recent payments
   - Insurance claims status
   - Quick actions (process payment, submit claim)

6. **Ward Nurse Dashboard**
   - Ward overview with bed status
   - Patients requiring attention
   - Medication schedule
   - Quick actions (record vitals, administer medication)

7. **Administrator Dashboard**
   - System status
   - Recent audit events
   - User activity metrics
   - Quick actions (manage users, view reports)

8. **Patient Portal Dashboard**
   - Upcoming appointments
   - Recent medical records
   - Prescription refill status
   - Quick actions (book appointment, view results)

## Core UI Components

### Navigation Components

1. **Main Navigation**
   - Hierarchical menu structure
   - Visual indicators for current section
   - Responsive behavior (side nav on desktop, bottom/hamburger on mobile)

2. **Breadcrumbs**
   - Shows navigation path
   - Clickable links to previous levels
   - Truncation for long paths on mobile

3. **Tabs**
   - Used for switching between related views
   - Underline style for active tab
   - Scrollable on mobile for many tabs

### Input Components

1. **Text Fields**
   - Single line and multi-line variants
   - Clear validation states (default, focus, error, disabled)
   - Support for helper text and character count
   - Floating labels for better usability

2. **Select Dropdowns**
   - Single and multi-select variants
   - Support for grouping and search in large lists
   - Custom styling consistent with text fields

3. **Date/Time Pickers**
   - Calendar view for date selection
   - Time selection with hour/minute inputs
   - Range selection support

4. **Checkboxes & Radio Buttons**
   - Clear visual states
   - Support for indeterminate state (checkboxes)
   - Group layout options (vertical/horizontal)

5. **Search Fields**
   - Autocomplete support
   - Recent searches
   - Advanced search options

6. **Form Layouts**
   - Single column on mobile
   - Multi-column on desktop
   - Logical grouping of related fields
   - Clear section headers

### Display Components

1. **Data Tables**
   - Sortable columns
   - Pagination
   - Row selection
   - Responsive behavior (horizontal scroll, stacking)
   - Filtering and search

2. **Cards**
   - Various layouts (simple, detailed, actionable)
   - Consistent padding and elevation
   - Support for headers, media, and actions

3. **Lists**
   - Simple, icon, and avatar list variants
   - Action support (swipe, click)
   - Dividers and grouping

4. **Charts & Visualizations**
   - Bar, line, and pie charts
   - Responsive sizing
   - Interactive tooltips
   - Accessible color schemes and patterns

5. **Status Indicators**
   - Badges for counts and status
   - Progress indicators (linear, circular)
   - Color-coded severity levels

### Action Components

1. **Buttons**
   - Primary, secondary, and tertiary variants
   - Icon support
   - Loading state
   - Size variants (small, medium, large)

2. **Floating Action Buttons**
   - For primary actions on mobile
   - Expandable for multiple actions

3. **Action Menus**
   - Dropdown menus for contextual actions
   - Icon and text options

4. **Dialogs & Modals**
   - Confirmation dialogs
   - Form dialogs
   - Full-screen dialogs on mobile
   - Proper focus management

### Feedback Components

1. **Notifications**
   - Toast messages for temporary feedback
   - Alert banners for persistent messages
   - Severity levels (info, success, warning, error)

2. **Empty States**
   - Helpful messaging when no data is available
   - Suggested actions

3. **Loading States**
   - Skeleton screens for content loading
   - Progress indicators for operations
   - Inline loading states for buttons/actions

4. **Error States**
   - Form validation errors
   - Page/section error states
   - Error boundaries for graceful failure

## Role-Specific UI Components

### Front Desk / Registration Components

1. **Patient Registration Form**
   - Multi-step form with progress indicator
   - Smart validation (e.g., ID number format)
   - Insurance information capture
   - Photo capture option

2. **Appointment Scheduler**
   - Calendar view with availability
   - List view option
   - Quick appointment creation
   - Conflict detection

3. **Patient Search**
   - Advanced search with multiple parameters
   - Recent patients list
   - Quick action buttons for common tasks

### Doctor Components

1. **Patient Timeline**
   - Chronological view of patient history
   - Filtering by record type
   - Interactive timeline navigation

2. **Clinical Notes Editor**
   - Rich text editing
   - Templates for common scenarios
   - Voice input support (future enhancement)
   - Auto-save functionality

3. **Order Entry**
   - Structured forms for lab orders
   - Medication prescribing with dosage calculator
   - Favorites and recent orders

4. **Medical Record Viewer**
   - Tabbed interface for different record types
   - Comparison view for lab results
   - PDF export option

### Lab Technician Components

1. **Lab Order Queue**
   - Filterable list of pending orders
   - Priority indicators
   - Batch processing options

2. **Result Entry Forms**
   - Structured data entry with validation
   - Reference range indicators
   - Abnormal result flagging

3. **Result Comparison View**
   - Historical result comparison
   - Trend visualization
   - Normal range indicators

### Pharmacist Components

1. **Prescription Queue**
   - Filterable list of pending prescriptions
   - Priority indicators
   - Patient context display

2. **Medication Dispenser**
   - Barcode scanning support
   - Dosage verification
   - Patient instructions generator

3. **Inventory Dashboard**
   - Stock level indicators
   - Expiry date tracking
   - Reorder suggestions

4. **Drug Interaction Checker**
   - Visual severity indicators
   - Detailed interaction information
   - Alternative suggestion support

### Billing Components

1. **Invoice Generator**
   - Service selection interface
   - Insurance coverage calculator
   - Discount application
   - Payment plan options

2. **Payment Processor**
   - Multiple payment method support
   - Receipt generator
   - Payment verification

3. **Insurance Claim Manager**
   - Claim form generator
   - Status tracking
   - Rejection handling workflow

### Inpatient Components

1. **Bed Management Dashboard**
   - Visual ward layout
   - Occupancy status indicators
   - Patient assignment interface

2. **Vital Signs Recorder**
   - Quick entry forms
   - Trend visualization
   - Abnormal value alerts

3. **Medication Administration Record**
   - Scheduled vs. actual administration tracking
   - Barcode verification
   - Missed dose handling

### Administrator Components

1. **User Management Console**
   - User creation and editing
   - Role assignment
   - Permission management
   - Bulk operations

2. **Audit Log Viewer**
   - Advanced filtering
   - Export functionality
   - Visual patterns detection

3. **System Configuration Panel**
   - Organized settings categories
   - Search functionality
   - Change history tracking

### Patient Portal Components

1. **Appointment Booking**
   - Available slot selection
   - Doctor/service filtering
   - Confirmation workflow

2. **Medical Record Viewer**
   - Simplified view of medical history
   - Lab result visualization
   - Medication history

3. **Messaging System**
   - Secure messaging with providers
   - Attachment support
   - Notification preferences

## Responsive Design Approach

The HMS frontend will implement a mobile-first responsive design approach:

1. **Breakpoints**
   - Small: 0-599px (mobile)
   - Medium: 600-959px (tablet)
   - Large: 960-1279px (desktop)
   - Extra Large: 1280px+ (large desktop)

2. **Layout Adaptations**
   - Single column layouts on mobile
   - Multi-column layouts on larger screens
   - Collapsible side navigation on desktop
   - Bottom navigation on mobile
   - Responsive tables (horizontal scroll or card view)

3. **Touch Optimization**
   - Larger touch targets on mobile (min 48px)
   - Swipe gestures for common actions
   - Context menus adapted for touch

4. **Performance Considerations**
   - Lazy loading of non-critical components
   - Image optimization for different screen sizes
   - Reduced animations on low-power devices

## Accessibility Considerations

The HMS frontend will be designed with accessibility as a core principle:

1. **Color Contrast**
   - Minimum 4.5:1 contrast ratio for normal text
   - Minimum 3:1 contrast ratio for large text
   - Non-reliance on color alone for conveying information

2. **Keyboard Navigation**
   - Full keyboard accessibility
   - Logical tab order
   - Focus indicators

3. **Screen Reader Support**
   - Semantic HTML structure
   - ARIA labels where needed
   - Meaningful alt text for images

4. **Reduced Motion**
   - Respecting user preferences for reduced motion
   - Essential animations only

5. **Text Sizing**
   - Support for browser text resizing
   - No fixed font sizes in pixels

This component design provides a foundation for a modern, accessible, and user-friendly Hospital Management System frontend that addresses the needs of all identified user roles and journeys.
