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
