# Chronicle Design System

A magazine-style, narrative-focused design system for healthcare interfaces.

## Philosophy

**"Patient data as story, not spreadsheet."**

Chronicle transforms clinical data from database rows into meaningful narratives. Every patient has a story; the UI honors that through editorial typography, warm colors, and timeline-centric layouts.

---

## Typography

| Role | Font | Usage |
|------|------|-------|
| Display | `Fraunces` | Patient names, page titles |
| Heading | `DM Sans` | Section headers, labels |
| Data | `IBM Plex Mono` | MRNs, vitals, timestamps, clinical data |

```css
.font-display { font-family: var(--font-fraunces); }
.font-heading { font-family: var(--font-dm-sans); }
.font-mono { font-family: var(--font-ibm-plex-mono); }
```

---

## Color Palette

### Base (Warm Stone)
- Background: `oklch(0.14 0.01 50)` - warm charcoal
- Foreground: `oklch(0.97 0.005 60)` - warm white
- Card: `oklch(0.18 0.01 50)` - elevated surface
- Border: `oklch(0.25 0.01 50)` - subtle dividers

### Accents
| Color | OKLCH | Usage |
|-------|-------|-------|
| Amber | `oklch(0.75 0.18 55)` | Primary actions, attention, timeline nodes |
| Emerald | `oklch(0.70 0.17 155)` | Positive/stable status |
| Rose | `oklch(0.65 0.22 15)` | Critical alerts, allergies |
| Sky | `oklch(0.70 0.15 230)` | Informational, medications |

---

## Components

### PatientChronicleCard
Magazine-style patient list card with:
- Status ribbon (critical/warning/stable)
- Display typography for names
- Clinical synopsis grid
- Vitals sparkline
- Hover-reveal actions

```jsx
import { PatientChronicleCard } from '@/components/chronicle';

<PatientChronicleCard
  patient={patient}
  index={0}
  onStartRound={handleStartRound}
/>
```

### TimelineEntry
Chronological clinical event with:
- Color-coded nodes by entry type
- Expandable content
- Author attribution
- Type-specific content renderers

```jsx
import { TimelineEntry, TimelineGroup } from '@/components/chronicle';

<TimelineGroup date="Today" entries={entries} />
```

Entry types: `progress_note`, `vitals`, `medication`, `lab_result`, `order`, `consult`, `admission`, `discharge`, `procedure`

### ClinicalSummarySidebar
Always-visible patient context:
- Active problems with severity
- Current medications
- High-visibility allergies
- Recent lab results with abnormal highlighting

```jsx
import { ClinicalSummarySidebar } from '@/components/chronicle';

<ClinicalSummarySidebar
  patient={patient}
  problems={problems}
  medications={medications}
  allergies={allergies}
  labResults={labResults}
/>
```

### PatientIdentityHero
Editorial patient header with:
- Large display name
- Demographics line
- Prominent allergy warnings
- Quick action buttons

```jsx
import { PatientIdentityHero } from '@/components/chronicle';

<PatientIdentityHero
  patient={patient}
  onAddNote={handleAddNote}
  onRecordVitals={handleRecordVitals}
  onPrescribe={handlePrescribe}
/>
```

---

## Animations

### Entry Animation
```css
.animate-chronicle-enter {
  animation: chronicle-enter 0.5s ease-out both;
}
```
Use with stagger classes: `.stagger-1` through `.stagger-10` (50ms increments)

### Node Pulse
```css
.animate-node-pulse {
  animation: node-pulse 2s ease-in-out infinite;
}
```
For recent/active timeline nodes.

### Vital Update Flash
```css
.animate-vital-update {
  animation: vital-update 1s ease-out;
}
```
Flash highlight when vitals update.

---

## CSS Utilities

### Status Ribbons
```css
.status-ribbon-critical  /* Rose gradient */
.status-ribbon-warning   /* Amber gradient */
.status-ribbon-stable    /* Emerald gradient */
```

### Timeline
```css
.timeline-spine          /* Gradient vertical line */
.timeline-node           /* Base node styling */
.timeline-node-amber     /* Amber node with glow */
.timeline-node-emerald   /* Emerald node with glow */
.timeline-node-rose      /* Rose node with glow */
.timeline-node-sky       /* Sky node with glow */
```

### Badges
```css
.badge-chronicle-amber
.badge-chronicle-emerald
.badge-chronicle-rose
.badge-chronicle-sky
```

### Dividers
```css
.divider-gradient  /* Fade-out horizontal divider */
```

---

## Page Layouts

### Patient List (PatientChronicleListPage)
- Hero header with stats
- Search + ward filter + view toggle
- Grid (default) or list view
- Staggered card animations

### Patient Detail (PatientChroniclePage)
- PatientIdentityHero header
- Two-column layout:
  - Left: ClinicalSummarySidebar (sticky)
  - Right: Filterable timeline chronicle

---

## Usage Guidelines

### Do
- Use `font-display` for patient names
- Use `font-mono` for all clinical data (MRNs, vitals, timestamps)
- Show allergies prominently with rose accent
- Use timeline as primary navigation metaphor
- Stagger animations on list renders
- Keep actions visible on hover

### Don't
- Use generic system fonts
- Hide critical information in tabs
- Use flat lists for clinical events
- Overload with simultaneous animations
- Mix design systems on same page

---

## File Structure

```
frontend/src/components/chronicle/
├── index.js                    # Exports
├── PatientChronicleCard.jsx    # List card component
├── TimelineEntry.jsx           # Timeline components
├── ClinicalSummarySidebar.jsx  # Context sidebar
└── PatientIdentityHero.jsx     # Patient header

frontend/src/pages/patients/
├── PatientChronicleListPage.jsx  # /patients
└── PatientChroniclePage.jsx      # /patients/:id
```

---

## Mobile Responsiveness

Chronicle is designed mobile-first. All components should adapt gracefully to smaller screens.

### Breakpoints

Use Tailwind's responsive prefixes:
- Default (no prefix): Mobile (< 640px)
- `sm:`: Small screens (≥ 640px)
- `md:`: Medium screens (≥ 768px)
- `lg:`: Large screens (≥ 1024px)

### Responsive Patterns

#### Typography Scaling
```jsx
// Page titles - smaller on mobile
<h1 className="font-display text-2xl sm:text-3xl lg:text-4xl">

// Card headers - readable on small screens
<h3 className="font-display text-lg sm:text-2xl truncate">

// Data labels - compact on mobile
<span className="font-mono text-[9px] sm:text-[10px] uppercase">

// Body text
<span className="text-xs sm:text-sm">
```

#### Spacing & Padding
```jsx
// Page containers
<div className="p-4 sm:p-6">

// Card components
<article className="p-4 sm:p-6 rounded-xl sm:rounded-2xl">

// Section margins
<div className="mb-3 sm:mb-4">
<div className="gap-2 sm:gap-6">
```

#### Touch-Friendly Actions
```jsx
// Buttons always visible on mobile, hover on desktop
<div className="flex gap-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
  <Button className="flex-1 sm:flex-none h-8">Action</Button>
</div>

// Full-width buttons on mobile
<Button className="w-full sm:w-auto">Register</Button>
```

#### Grid to Stack Layout
```jsx
// Vitals: grid on mobile, flex on desktop
<div className="grid grid-cols-4 gap-2 sm:flex sm:items-center sm:gap-4">

// Info grid: compact on mobile
<div className="grid grid-cols-3 gap-2 sm:gap-6">

// Card grid: responsive columns
<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
```

#### Badges & Status Indicators
```jsx
// Stack vertically on mobile
<div className="flex flex-col sm:flex-row items-end sm:items-center gap-1 sm:gap-2">
  <span className="badge-chronicle-rose text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">
    <span className="hidden sm:inline">CRITICAL</span>
    <span className="sm:hidden">CRIT</span>
  </span>
</div>
```

#### Text Truncation
```jsx
// Prevent overflow on small screens
<div className="min-w-0 flex-1">
  <h3 className="truncate">Long patient name here</h3>
</div>
```

#### Filters & Controls
```jsx
// Stack filters on mobile
<div className="flex flex-col gap-3">
  <Input className="w-full" />
  <div className="flex flex-wrap items-center gap-2">
    <Select className="w-full sm:w-[160px]">
    <div className="ml-auto">...</div>
  </div>
</div>
```

### Mobile Guidelines

#### Do
- Use `text-[10px] sm:text-xs` for compact data
- Make all buttons/actions visible on mobile (no hover-only)
- Use `flex-1` for full-width mobile buttons
- Add `truncate` and `min-w-0` for text overflow
- Stack elements with `flex-col sm:flex-row`
- Use smaller padding: `p-4 sm:p-6`
- Show abbreviated text on mobile: `<span className="sm:hidden">ALLERGY</span>`

#### Don't
- Use fixed large font sizes without responsive variants
- Rely on hover states for critical actions
- Use wide fixed-width elements on mobile
- Forget `min-w-0` when using truncate in flex containers
- Use horizontal layouts that overflow on small screens

---

## Extending Chronicle

When building new pages:

1. **Import chronicle components**
   ```jsx
   import { PatientIdentityHero, ClinicalSummarySidebar } from '@/components/chronicle';
   ```

2. **Use chronicle typography**
   ```jsx
   <h1 className="font-display text-4xl">Page Title</h1>
   <span className="font-mono text-xs">MRN-2024-00847</span>
   ```

3. **Apply chronicle colors**
   ```jsx
   <div className="bg-card border-border">
   <span className="text-primary">Amber accent</span>
   <span className="badge-chronicle-rose">Critical</span>
   ```

4. **Use chronicle animations**
   ```jsx
   <div className="animate-chronicle-enter stagger-1">
   ```
