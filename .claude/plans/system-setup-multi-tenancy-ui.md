# HMS System Setup & Multi-Tenancy UI Design Plan

## Overview

This document outlines the complete UI design for system setup and multi-tenancy management in HMS. The design supports three deployment variants: Single Hospital, Hospital Network, and National/Regional deployments.

---

## Design Requirements Summary

### Target Users & Context

| Aspect | Decision |
|--------|----------|
| Primary users | Mix: IT staff, hospital admins, implementation partners |
| Common deployment | Multi-facility networks (80%+) |
| Infrastructure handling | Backend-managed provisioning jobs; UI triggers + monitors |
| Compliance framework | GDPR |

### Key UX Decisions

| Area | Decision |
|------|----------|
| Infrastructure visibility | Transparent job status; no infrastructure credentials in UI |
| First launch | Landing page with "Get Started" CTA |
| Interruption handling | Auto-save progress, resume on return |
| Post-setup | Setup checklist (what's still needed) |
| Error handling | User-friendly with retry option |
| Demo mode | Sandbox environment separate from production, watermarked, exports/interop blocked |
| Adding facilities | Instant request; provisioning async; facility activates when ready |
| Org templates | System-provided now; custom templates allowed later |
| Bulk operations | CSV import/export supported |
| Facility switching | Header dropdown; guard unsaved changes; reload on confirm |
| Cross-facility search | No - strict isolation (must switch first) |
| Org editor | Visual tree with drag-drop |
| Change management | Draft & publish workflow |
| Publish approval | Admin publishes directly by default; optional approval chain |
| Deactivation | Cascade options (move up, deactivate subtree, or block) |
| Version history | Audit log only (not visual version browsing) |
| Staff assignment | Bidirectional (from org view OR staff view) |
| Audit level | Compliance-grade (full diff + reason); approval chain optional |
| Admin roles | Granular permissions + mandatory MFA (TOTP + WebAuthn) |
| Mobile support | Full mobile support for all admin features |

---

## Information Architecture

```
SYSTEM ADMINISTRATION
│
├── First-Time Setup
│   ├── Welcome Landing Page
│   ├── Setup Wizard (auto-saving, resumable)
│   └── Post-Setup Checklist
│
├── Network Administration
│   ├── Network Dashboard (cards + map toggle)
│   ├── Add Facility Flow
│   ├── Facility Settings
│   └── Network-wide Settings
│
├── Facility Administration
│   ├── Org Structure Editor (drag-drop tree)
│   ├── Draft & Publish Workflow
│   ├── Staff Assignment (bidirectional)
│   ├── Bulk Import (CSV)
│   └── Facility Settings
│
├── Access Control
│   ├── Granular Permissions Management
│   ├── Role Definitions
│   └── User Access Audit
│
└── Compliance & Audit
    ├── Change Audit Log (compliance-grade)
    ├── GDPR Data Management
    └── Export/Reporting
```

---

## 1. First-Time Setup Experience

### 1.1 Welcome Landing Page

**Purpose:** First impression, set expectations, allow resume of interrupted setup.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                          ┌───────────────┐                              │
│                          │   HMS Logo    │                              │
│                          └───────────────┘                              │
│                                                                         │
│                    Welcome to HMS                                       │
│                    Healthcare Management System                         │
│                                                                         │
│          Let's get your healthcare network up and running.              │
│          This wizard will guide you through:                            │
│                                                                         │
│          ✓ Choosing your deployment type                                │
│          ✓ Creating your first facility                                 │
│          ✓ Setting up organizational structure                          │
│          ✓ Creating your admin account                                  │
│                                                                         │
│          ┌──────────────────────────────────┐                           │
│          │         Get Started →            │                           │
│          └──────────────────────────────────┘                           │
│                                                                         │
│          Estimated time: 10-15 minutes                                  │
│          Progress is saved automatically                                │
│                                                                         │
│          ─────────────────────────────────────                          │
│          Already started? [Resume Setup]                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Components:**
- Logo and branding
- Value proposition (what wizard accomplishes)
- Primary CTA: "Get Started"
- Time estimate
- Resume link for interrupted sessions

---

### 1.2 Setup Wizard

#### Step Indicator (persistent header)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ●━━━━━━━○━━━━━━━○━━━━━━━○━━━━━━━○                                      │
│  Type    Facility  Structure  Admin   Review                            │
│                                                                         │
│  Progress auto-saved                              [Save & Exit]         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Step 1: Deployment Type

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 1: Deployment Type                                                │
│                                                                         │
│  How will you be using HMS?                                             │
│                                                                         │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │                             │  │                                 │  │
│  │  🏥 Single Hospital         │  │  🏢 Multi-Facility Network      │  │
│  │                             │  │     (Recommended)               │  │
│  │  • One facility             │  │                                 │  │
│  │  • One database             │  │  • Multiple facilities          │  │
│  │  • Simplest setup           │  │  • Separate DB per facility     │  │
│  │                             │  │  • Shared patient identity      │  │
│  │  Best for: Standalone       │  │  • Strongest data isolation     │  │
│  │  hospitals, clinics         │  │                                 │  │
│  │                             │  │  Best for: Hospital chains,     │  │
│  │                             │  │  regional networks              │  │
│  │                             │  │                                 │  │
│  │       [ Select ]            │  │       [ Select ]                │  │
│  └─────────────────────────────┘  └─────────────────────────────────┘  │
│                                                                         │
│  ┌─ Note ──────────────────────────────────────────────────────────────┐│
│  │ You can add more facilities later. Upgrading from Single Hospital  ││
│  │ to Multi-Facility is supported via a guided migration plan.        ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key points:**
- Multi-facility is recommended (80%+ deployments)
- Separate DB per facility is the default architecture
- Upgrade path clearly communicated

---

#### Step 2: First Facility Details

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 2: Your First Facility                                           │
│                                                                         │
│  ┌─ Identity ──────────────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  Facility Code *        [ MAIN________ ]                            ││
│  │                         Used in system URLs and APIs                ││
│  │                         Format: A-Z, 0-9, "-" (3-20), no PHI        ││
│  │                                                                     ││
│  │  Facility Name *        [ City General Hospital________________ ]   ││
│  │                                                                     ││
│  │  Facility Type *        [ Hospital ▼ ]                              ││
│  │                         ┌─────────────────────────┐                 ││
│  │                         │ Hospital                │                 ││
│  │                         │ Clinic                  │                 ││
│  │                         │ Diagnostic Center       │                 ││
│  │                         │ Specialty Center        │                 ││
│  │                         │ Rehabilitation Center   │                 ││
│  │                         └─────────────────────────┘                 ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Location ──────────────────────────────────────────────────────────┐│
│  │  Address            [ 123 Medical Drive________________________ ]   ││
│  │  City *             [ Accra_________ ]  Region [ Greater Accra__ ]  ││
│  │  Country *          [ Ghana 🇬🇭 ▼ ]     Postal  [ GA-123-4567___ ]  ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Operations ────────────────────────────────────────────────────────┐│
│  │  Timezone *         [ Africa/Accra (GMT+0) ▼ ]                      ││
│  │  Currency *         [ GHS - Ghana Cedi ▼ ]                          ││
│  │  Contact Email      [ info@citygeneral.com__________________ ]      ││
│  │  Contact Phone      [ +233 XX XXX XXXX______________________ ]      ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│                                              [ ← Back ]  [ Continue → ] │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### Step 2b: Database Provisioning (Transparent Progress)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 2: Your First Facility                                           │
│                                                                         │
│  ┌─ Setting Up Infrastructure ─────────────────────────────────────────┐│
│  │                                                                     ││
│  │     ✓  Validating facility configuration                           ││
│  │     ✓  Creating facility database                                  ││
│  │     ◐  Running database migrations...                              ││
│  │     ○  Initializing default settings                               ││
│  │     ○  Setting up organization schema                              ││
│  │                                                                     ││
│  │     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  65%                     ││
│  │                                                                     ││
│  │     This usually takes 30-60 seconds                               ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key points:**
- Show what's happening (transparent)
- But fully automated (guided)
- Progress indicator with time estimate
- Provisioning runs as backend jobs with IAM; UI only monitors status

---

#### Step 2c: Error State

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 2: Your First Facility                                           │
│                                                                         │
│  ┌─ Setup Issue ───────────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │     ⚠️  We couldn't complete the database setup                     ││
│  │                                                                     ││
│  │     This can happen due to temporary network issues or             ││
│  │     server load. Your progress has been saved.                     ││
│  │                                                                     ││
│  │     ┌────────────────────┐  ┌────────────────────┐                 ││
│  │     │     Try Again      │  │   Contact Support  │                 ││
│  │     └────────────────────┘  └────────────────────┘                 ││
│  │                                                                     ││
│  │     Reference ID: PROV-12345 (include in support request)           ││
│  │                                                                     ││
│  │     ▸ Show technical details                                       ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key points:**
- User-friendly language
- Clear retry action
- Technical details expandable (not default)
- Progress preserved

---

#### Step 3: Organization Structure Template

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 3: Organization Structure                                         │
│                                                                         │
│  Choose a starting template for your facility's departments and units.  │
│  You can customize this after setup.                                    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  ● 🏥 General Hospital                                              ││
│  │    Emergency, Internal Medicine, Surgery, Pediatrics, OB/GYN,       ││
│  │    Pharmacy, Laboratory, Radiology                                  ││
│  │    ▸ Preview structure                                              ││
│  ├─────────────────────────────────────────────────────────────────────┤│
│  │  ○ 🏨 Specialty Hospital                                            ││
│  │    Core departments + 3 specialty slots to configure                ││
│  │    ▸ Preview structure                                              ││
│  ├─────────────────────────────────────────────────────────────────────┤│
│  │  ○ 🏪 Outpatient Clinic                                             ││
│  │    Reception, Consultation, Pharmacy, Laboratory                    ││
│  │    ▸ Preview structure                                              ││
│  ├─────────────────────────────────────────────────────────────────────┤│
│  │  ○ 🔬 Diagnostic Center                                             ││
│  │    Laboratory, Radiology, Specimen Collection                       ││
│  │    ▸ Preview structure                                              ││
│  ├─────────────────────────────────────────────────────────────────────┤│
│  │  ○ ⚙️  Minimal (Start Empty)                                        ││
│  │    Just the facility root - build your own structure                ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│                                              [ ← Back ]  [ Continue → ] │
└─────────────────────────────────────────────────────────────────────────┘
```

**System-provided templates:**
1. General Hospital (default)
2. Specialty Hospital
3. Outpatient Clinic
4. Diagnostic Center
5. Minimal (empty)

---

#### Step 3b: Template Preview Modal

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Template Preview: General Hospital                            [ × ]   │
│                                                                         │
│  🏥 City General Hospital                                               │
│  ├── 🚨 Emergency Department                                            │
│  │   ├── Triage                                                         │
│  │   ├── Resuscitation                                                  │
│  │   └── Observation                                                    │
│  ├── 🩺 Internal Medicine                                               │
│  │   ├── Cardiology                                                     │
│  │   ├── Pulmonology                                                    │
│  │   ├── Gastroenterology                                               │
│  │   └── General Medicine                                               │
│  ├── 🔪 Surgery                                                         │
│  │   ├── General Surgery                                                │
│  │   ├── Orthopedics                                                    │
│  │   └── Neurosurgery                                                   │
│  ├── 👶 Pediatrics                                                      │
│  ├── 🤰 Obstetrics & Gynecology                                         │
│  ├── 💊 Pharmacy                                                        │
│  ├── 🔬 Laboratory                                                      │
│  └── 📷 Radiology                                                       │
│                                                                         │
│  22 units total • You can add, remove, or reorganize after setup       │
│                                                                         │
│                                                    [ Use This Template ] │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### Step 4: Administrator Account

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 4: Administrator Account                                          │
│                                                                         │
│  Create the first administrator account. This account will have        │
│  full system access and can create additional users.                    │
│  MFA is required for admin accounts: TOTP + WebAuthn.                  │
│  This admin will be assigned to the first facility created.             │
│                                                                         │
│  ┌─ Account Details ───────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  Full Name *        [ Dr. Kwame Asante_________________________ ]   ││
│  │  Email *            [ kwame.asante@citygeneral.com_____________ ]   ││
│  │  Phone              [ +233 XX XXX XXXX_________________________ ]   ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Security ──────────────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  Password *         [ •••••••••••••••__________________________ ]   ││
│  │                     Min 12 characters, mix of letters & numbers     ││
│  │                                                                     ││
│  │  Confirm *          [ •••••••••••••••__________________________ ]   ││
│  │                     ✓ Passwords match                               ││
│  │                                                                     ││
│  │  ☑ TOTP + WebAuthn required for admin                               ││
│  │  Platform authenticators + security keys allowed (resident keys)    ││
│  │  Recovery codes will be generated for break-glass access            ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Permissions ───────────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  This account will receive:                                         ││
│  │  ✓ Full system administration access                               ││
│  │  ✓ Network management (add/manage facilities)                      ││
│  │  ✓ User and role management                                        ││
│  │  ✓ Audit log access                                                ││
│  │  ✓ GDPR data management                                            ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│                                              [ ← Back ]  [ Continue → ] │
└─────────────────────────────────────────────────────────────────────────┘
```

---

#### Step 5: Review & Complete

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 5: Review & Complete                                              │
│                                                                         │
│  Please review your setup before completing.                            │
│                                                                         │
│  ┌─ Deployment ────────────────────────────────────────────────────────┐│
│  │  Type:              Multi-Facility Network                   [Edit] ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Facility ──────────────────────────────────────────────────────────┐│
│  │  Code:              MAIN                                     [Edit] ││
│  │  Name:              City General Hospital                           ││
│  │  Type:              Hospital                                        ││
│  │  Location:          Accra, Greater Accra, Ghana                     ││
│  │  Timezone:          Africa/Accra (GMT+0)                            ││
│  │  Currency:          GHS - Ghana Cedi                                ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Organization ──────────────────────────────────────────────────────┐│
│  │  Template:          General Hospital                         [Edit] ││
│  │  Departments:       8 departments, 22 total units                   ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Administrator ─────────────────────────────────────────────────────┐│
│  │  Name:              Dr. Kwame Asante                         [Edit] ││
│  │  Email:             kwame.asante@citygeneral.com                    ││
│  │  2FA:               Enabled (TOTP + WebAuthn)                       ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ GDPR Compliance ───────────────────────────────────────────────────┐│
│  │  ☑ I confirm this system will be used in compliance with GDPR      ││
│  │  ☑ I understand I am responsible for data protection policies      ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│                                      [ ← Back ]  [ Complete Setup ✓ ]   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 1.3 Post-Setup Checklist

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🎉 Setup Complete!                                                     │
│                                                                         │
│  City General Hospital is ready. Complete these steps to fully         │
│  configure your facility.                                               │
│                                                                         │
│  ┌─ Getting Started Checklist ─────────────────────────────────────────┐│
│  │                                                                     ││
│  │  Essential (do first)                                               ││
│  │  ─────────────────────────────────────────────────────────────────  ││
│  │  ☑ Create facility                                    Completed    ││
│  │  ☑ Set up organization structure                      Completed    ││
│  │  ☐ Add wards and beds                                 [ Start → ]  ││
│  │  ☐ Create staff accounts                              [ Start → ]  ││
│  │  ☐ Assign staff to departments                        [ Start → ]  ││
│  │                                                                     ││
│  │  Configure Services                                                 ││
│  │  ─────────────────────────────────────────────────────────────────  ││
│  │  ☐ Set up billing & pricing                           [ Start → ]  ││
│  │  ☐ Configure appointment types                        [ Start → ]  ││
│  │  ☐ Set up laboratory services                         [ Start → ]  ││
│  │  ☐ Configure pharmacy inventory                       [ Start → ]  ││
│  │                                                                     ││
│  │  Compliance & Security                                              ││
│  │  ─────────────────────────────────────────────────────────────────  ││
│  │  ☐ Configure consent forms (GDPR)                     [ Start → ]  ││
│  │  ☐ Set up data retention policies                     [ Start → ]  ││
│  │  ☐ Review user permissions                            [ Start → ]  ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  [ Go to Dashboard ]              [ Continue Setup Checklist ]      ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  You can return to this checklist anytime from Settings → Setup        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Checklist categories:**
1. Essential (blocking for operations)
2. Configure Services
3. Compliance & Security

---

## 2. Network Administration

### 2.1 Network Dashboard

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ☰  HMS Network Administration     🔔 3    👤 Dr. Asante   [ MAIN ▼ ]  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Network Overview                    [ Cards ][ Map ]    [+ Add Facility]
│                                                                         │
│  ┌─ Metric Toggles ─────────────────────────────────────────────────── │
│  │ ☑ Operational  ☑ Clinical  ☑ System Health     [ Customize → ]     │
│  └──────────────────────────────────────────────────────────────────── │
│                                                                         │
│  ┌─ Facilities ────────────────────────────────────────────────────────┐
│  │                                                                     │
│  │  ┌────────────────────────┐  ┌────────────────────────┐            │
│  │  │ 🏢 MAIN                │  │ 🏥 BRANCH-EAST          │            │
│  │  │ City General Hospital  │  │ East Branch Hospital    │            │
│  │  │ Accra • Headquarters   │  │ Tema                    │            │
│  │  │                        │  │                         │            │
│  │  │ ┌─ Operational ──────┐ │  │ ┌─ Operational ───────┐ │            │
│  │  │ │ 👥 245 staff       │ │  │ │ 👥 89 staff         │ │            │
│  │  │ │ 🛏️ 120 beds        │ │  │ │ 🛏️ 45 beds          │ │            │
│  │  │ │ 📊 92% occupancy   │ │  │ │ 📊 78% occupancy    │ │            │
│  │  │ └────────────────────┘ │  │ └─────────────────────┘ │            │
│  │  │                        │  │                         │            │
│  │  │ ┌─ Clinical ─────────┐ │  │ ┌─ Clinical ──────────┐ │            │
│  │  │ │ ↗️ 47 admissions   │ │  │ │ ↗️ 18 admissions    │ │            │
│  │  │ │ ↘️ 39 discharges   │ │  │ │ ↘️ 15 discharges    │ │            │
│  │  │ │ ⏳ 3 pending xfers │ │  │ │ ⏳ 1 pending xfer   │ │            │
│  │  │ └────────────────────┘ │  │ └─────────────────────┘ │            │
│  │  │                        │  │                         │            │
│  │  │ ● Online    [Manage]   │  │ ● Online    [Manage]    │            │
│  │  └────────────────────────┘  └─────────────────────────┘            │
│  │                                                                     │
│  └─────────────────────────────────────────────────────────────────────┘
│                                                                         │
│  ┌─ Network Summary ───────────────────────────────────────────────────┐
│  │  Facilities: 4    Staff: 413    Beds: 197    Avg Occupancy: 82%    │
│  └─────────────────────────────────────────────────────────────────────┘
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Card grid view (default)
- Map toggle
- Configurable metrics (operational, clinical, system health)
- Network summary bar
- Quick add facility action

---

### 2.2 Map View Toggle

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Network Overview                    [ Cards ][ Map ●]  [+ Add Facility]│
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │                    ○ Tamale Regional                                ││
│  │                      (Planned)                                      ││
│  │                                                                     ││
│  │                         ○ Kumasi Central                            ││
│  │                           (Planned)                                 ││
│  │                                                                     ││
│  │                                  ● BRANCH-EAST                      ││
│  │                                    Tema                             ││
│  │               ○ BRANCH-WEST       45 beds • 78%                     ││
│  │                 Kasoa                                               ││
│  │                 32 beds          ● MAIN (HQ)                        ││
│  │                                    Accra                            ││
│  │                                    120 beds • 92%                   ││
│  │                                  ○ CLINIC-CBD                       ││
│  │                                    Accra CBD                        ││
│  │                                    Outpatient only                  ││
│  │                                                                     ││
│  │  ─────────────────────────────────────────────────────────────────  ││
│  │  ● Online (4)   ○ Planned (2)   ◉ Issues (0)                       ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 2.3 Add Facility Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Add New Facility                                                [ × ] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─ Facility Type ─────────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  ○ Branch Hospital                                                  ││
│  │    Full-service hospital, part of the network                       ││
│  │                                                                     ││
│  │  ● Satellite Clinic                                                 ││
│  │    Outpatient services, refers complex cases to hospitals           ││
│  │                                                                     ││
│  │  ○ Diagnostic Center                                                ││
│  │    Laboratory and imaging services                                  ││
│  │                                                                     ││
│  │  ○ Specialty Center                                                 ││
│  │    Focused specialty (dialysis, oncology, rehab, etc.)              ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Network Relationship ──────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  Reports to:        [ City General Hospital (HQ) ▼ ]                ││
│  │                                                                     ││
│  │  Relationship type:                                                 ││
│  │  ● Full subsidiary (shared admin, policies, staff pool)            ││
│  │  ○ Affiliate (independent ops, shared patient records)             ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Data Architecture ─────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  ℹ️  Each facility gets its own isolated database.                  ││
│  │     Patient identity (MPI) and consent are shared across            ││
│  │     the network for continuity of care.                             ││
│  │                                                                     ││
│  │  Provisioning runs in the backend; the facility is inactive until   ││
│  │  status is "Ready".                                                 ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│                                     [ Cancel ]  [ Next: Details → ]    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key points:**
- Instant request (no approval workflow); activates after provisioning
- Separate DB per facility (default architecture)
- Parent facility relationship
- Relationship type affects permissions/policies

---

## 3. Facility Administration

### 3.1 Organization Structure Editor

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Organization Structure                                                 │
│  City General Hospital                        [ Discard ] [ Publish ▼ ]│
│                                                                         │
│  ┌─ Draft Mode ────────────────────────────────────────────────────────┐│
│  │ ⚠️  You have unpublished changes (12 modifications)    [View Diff] ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Tree ──────────────────────────────┬─ Details ─────────────────────┐│
│  │                                     │                               ││
│  │ 🔍 Search units...     [+ Add Unit] │  🩺 Internal Medicine         ││
│  │                                     │                               ││
│  │ 🏥 City General Hospital            │  ┌─ Identity ───────────────┐ ││
│  │ ├── 🚨 Emergency        (24)        │  │ Code      MED            │ ││
│  │ ├── 🩺 Internal Med ◀━  (18)        │  │ Name      Internal Med.  │ ││
│  │ │   ├── Cardiology      (5)         │  │ Type      Department     │ ││
│  │ │   ├── Pulmonology     (4)         │  │ Head      Dr. K. Mensah  │ ││
│  │ │   ├── Gastro          (3)         │  └───────────────────────────┘ ││
│  │ │   └── General Med     (6)         │                               ││
│  │ ├── 🔪 Surgery          (22)        │  ┌─ Capabilities ───────────┐ ││
│  │ │   ├── General         (12)        │  │ ☑ Can admit patients    │ ││
│  │ │   ├── Orthopedics     (8)         │  │ ☑ Has own budget        │ ││
│  │ │   └── Neuro           (2)         │  │ ☑ Accepts referrals     │ ││
│  │ ├── 👶 Pediatrics       (8)         │  │ ☐ 24-hour operation     │ ││
│  │ ├── 🤰 OB/GYN           (10)        │  └───────────────────────────┘ ││
│  │ ├── 💊 Pharmacy         (6)         │                               ││
│  │ ├── 🔬 Laboratory       (5)         │  ┌─ Staff Summary ──────────┐ ││
│  │ └── 📷 Radiology        (4)         │  │ Doctors        8        │ ││
│  │                                     │  │ Nurses         6        │ ││
│  │ ─────────────────────────           │  │ Others         4        │ ││
│  │                                     │  │                         │ ││
│  │ 💡 Drag units to reorganize         │  │ [Manage Staff →]        │ ││
│  │ 💡 Right-click for more options     │  └───────────────────────────┘ ││
│  │                                     │                               ││
│  │ ─────────────────────────           │  [ Edit Unit ]  [ Delete ]    ││
│  │ [↑ Import CSV]  [↓ Export CSV]      │                               ││
│  └─────────────────────────────────────┴───────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Visual drag-drop tree
- Split view: tree + details panel
- Draft mode indicator
- Staff count per unit
- Quick actions: add, edit, delete
- CSV import/export

---

### 3.2 Publish Confirmation Dialog

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Publish Changes                                                 [ × ] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  You're about to publish 12 changes to the organization structure.     │
│                                                                         │
│  ┌─ Summary of Changes ────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  Added (2)                                                          ││
│  │  • Gastroenterology under Internal Medicine                         ││
│  │  • Neurosurgery under Surgery                                       ││
│  │                                                                     ││
│  │  Modified (3)                                                       ││
│  │  • Internal Medicine: updated head to Dr. K. Mensah                 ││
│  │  • Surgery: enabled 24-hour operation                               ││
│  │  • Cardiology: moved 2 staff from General Medicine                  ││
│  │                                                                     ││
│  │  Moved (1)                                                          ││
│  │  • Orthopedics: from top-level to under Surgery                     ││
│  │                                                                     ││
│  │  [View Full Diff →]                                                 ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Reason for Change (required for audit) ────────────────────────────┐│
│  │                                                                     ││
│  │  [ Reorganizing surgery department after Dr. Osei joined as       ] ││
│  │  [ head of Orthopedics. Adding new subspecialties per expansion   ] ││
│  │  [ plan approved by medical board on 2024-03-01.                  ] ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│                                        [ Cancel ]  [ Publish Changes ] │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key points:**
- Change summary (added, modified, moved)
- Full diff available
- Reason required (compliance-grade audit)
- No approval step by default; optional approval chain when enabled

---

### 3.3 Deactivation with Cascade Options

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Deactivate Unit                                                 [ × ] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  You're deactivating: General Medicine (under Internal Medicine)       │
│                                                                         │
│  This unit has:                                                         │
│  • 6 assigned staff members                                             │
│  • 2 child units (Ward A, Ward B)                                       │
│  • 12 active patients                                                   │
│                                                                         │
│  ┌─ What should happen to child units? ────────────────────────────────┐│
│  │                                                                     ││
│  │  ● Move up to parent (Internal Medicine)                            ││
│  │    Ward A and Ward B become direct children of Internal Medicine    ││
│  │                                                                     ││
│  │  ○ Deactivate entire subtree                                        ││
│  │    General Medicine, Ward A, and Ward B all deactivated             ││
│  │                                                                     ││
│  │  ○ Move to another unit                                             ││
│  │    [ Select destination unit ▼ ]                                    ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ What should happen to staff? ──────────────────────────────────────┐│
│  │                                                                     ││
│  │  ● Move to parent unit (Internal Medicine)                          ││
│  │  ○ Unassign (staff will need reassignment)                          ││
│  │  ○ Move to specific unit: [ Select unit ▼ ]                         ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Active Patients ───────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  ⚠️  12 patients are currently assigned to this unit.               ││
│  │     They will be moved to: Internal Medicine                        ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  Reason for deactivation:                                               │
│  [ Consolidating General Medicine into subspecialties______________ ]  │
│                                                                         │
│                              [ Cancel ]  [ Add to Draft ] [ Deactivate ]│
└─────────────────────────────────────────────────────────────────────────┘
```

**Cascade options:**
1. Move children up to parent
2. Deactivate entire subtree
3. Move to another unit

---

### 3.4 CSV Import Flow

#### Upload Screen

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Import Organization Structure                                   [ × ] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Upload a CSV file to bulk-create organizational units.                │
│                                                                         │
│  ┌─ File Upload ───────────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │        ┌─────────────────────────────────────────┐                  ││
│  │        │                                         │                  ││
│  │        │   📄 Drop CSV file here                 │                  ││
│  │        │      or click to browse                 │                  ││
│  │        │                                         │                  ││
│  │        └─────────────────────────────────────────┘                  ││
│  │                                                                     ││
│  │  [↓ Download Template]  [📖 View Format Guide]                      ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Expected Format ───────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  code,name,type,parent_code,can_admit,has_budget                   ││
│  │  MED,Internal Medicine,department,,true,true                        ││
│  │  CARD,Cardiology,division,MED,true,false                           ││
│  │  ...                                                                ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Validation Preview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Import Preview                                                  [ × ] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ✓ File validated: org_structure.csv                                   │
│                                                                         │
│  ┌─ Import Summary ────────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  Will create:     24 new units                                      ││
│  │  Will update:     3 existing units                                  ││
│  │  Errors:          2 rows with issues                                ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Errors (must fix) ─────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  Row 15: Invalid parent_code 'UNKNOWN' - parent not found          ││
│  │  Row 23: Duplicate code 'CARD' - already exists                    ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Preview (first 10 rows) ───────────────────────────────────────────┐│
│  │                                                                     ││
│  │  Code    Name                 Type        Parent    Status          ││
│  │  ───────────────────────────────────────────────────────────────    ││
│  │  MED     Internal Medicine    department  (root)    ✓ New          ││
│  │  CARD    Cardiology           division    MED       ⚠️ Duplicate   ││
│  │  PULM    Pulmonology          division    MED       ✓ New          ││
│  │  ...                                                                ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ☐ Skip rows with errors and import the rest (22 units)               │
│                                                                         │
│                      [ Cancel ]  [ Fix & Re-upload ]  [ Import → ]     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Staff Assignment (Bidirectional)

### 4.1 From Org Structure View (Unit → Staff)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Staff: Internal Medicine                                        [ × ] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─ Current Staff (18) ────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  🔍 Filter staff...                              [+ Assign Staff]   ││
│  │                                                                     ││
│  │  ┌─ Leadership ─────────────────────────────────────────────────┐   ││
│  │  │ 👤 Dr. Kofi Mensah          Head of Department    [Change]   │   ││
│  │  │ 👤 Dr. Ama Owusu            Deputy Head           [Change]   │   ││
│  │  └──────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  │  ┌─ Doctors (8) ────────────────────────────────────────────────┐   ││
│  │  │ 👤 Dr. Yaw Asante           Consultant     Primary   [Edit]  │   ││
│  │  │ 👤 Dr. Efua Dadzie          Consultant     Primary   [Edit]  │   ││
│  │  │ 👤 Dr. Kweku Boateng        Senior Reg.    Primary   [Edit]  │   ││
│  │  │ 👤 Dr. Akua Mensah          Registrar      Rotational[Edit]  │   ││
│  │  │ ...                                                          │   ││
│  │  └──────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  │  ┌─ Nurses (6) ─────────────────────────────────────────────────┐   ││
│  │  │ 👤 Nurse Adwoa Sarpong      Nurse Manager  Primary   [Edit]  │   ││
│  │  │ ...                                                          │   ││
│  │  └──────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 From Staff Management View (Staff → Units)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Back to Staff     Dr. Kofi Mensah                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─ Profile ────────┬─ Assignments ●───┬─ Schedule ─────┬─ Audit ─────┐ │
│  └──────────────────┴──────────────────┴────────────────┴─────────────┘ │
│                                                                         │
│  ┌─ Unit Assignments ──────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │                                                    [+ Add Assignment]││
│  │                                                                     ││
│  │  ┌──────────────────────────────────────────────────────────────┐   ││
│  │  │ 🩺 Internal Medicine                                         │   ││
│  │  │                                                              │   ││
│  │  │ Role: Head of Department                                     │   ││
│  │  │ Type: Primary Assignment                                     │   ││
│  │  │ Since: January 15, 2024                                      │   ││
│  │  │                                                              │   ││
│  │  │                                    [Edit]  [End Assignment]  │   ││
│  │  └──────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  │  ┌──────────────────────────────────────────────────────────────┐   ││
│  │  │ ❤️ Cardiology                                                │   ││
│  │  │                                                              │   ││
│  │  │ Role: Consulting Physician                                   │   ││
│  │  │ Type: Secondary Assignment                                   │   ││
│  │  │ Since: March 1, 2024                                         │   ││
│  │  │                                                              │   ││
│  │  │                                    [Edit]  [End Assignment]  │   ││
│  │  └──────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Facility Switcher

### 5.1 Desktop Header Dropdown

```
┌──────────────────────────────────────────────────────────────┐
│  City General (HQ) ▼                                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  🔍 Search facilities...                                     │
│                                                              │
│  ─── Your Facilities ───────────────────────────────────────│
│                                                              │
│  ● 🏢 City General Hospital                    ← Current     │
│       Accra • Headquarters                                   │
│                                                              │
│  ○ 🏥 East Branch Hospital                                   │
│       Tema                                                   │
│                                                              │
│  ─── Network ───────────────────────────────────────────────│
│                                                              │
│  ○ 🏥 West Branch Hospital                                   │
│       Kasoa                                                  │
│                                                              │
│  ○ 🏪 Downtown Clinic                                        │
│       Accra CBD                                              │
│                                                              │
│  ─────────────────────────────────────────────────────────── │
│  ⚙️ Network Settings (Admin)                                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 Mobile Full-Screen Picker

```
┌─────────────────────────────────┐
│  ← Select Facility              │
├─────────────────────────────────┤
│                                 │
│  🔍 Search...                   │
│                                 │
│  YOUR FACILITIES                │
│  ───────────────────────────────│
│                                 │
│  ┌─────────────────────────────┐│
│  │ 🏢 City General Hospital    ││
│  │    Accra • HQ        ● ←    ││
│  └─────────────────────────────┘│
│                                 │
│  ┌─────────────────────────────┐│
│  │ 🏥 East Branch Hospital     ││
│  │    Tema                     ││
│  └─────────────────────────────┘│
│                                 │
│  NETWORK                        │
│  ───────────────────────────────│
│                                 │
│  ┌─────────────────────────────┐│
│  │ 🏥 West Branch              ││
│  │    Kasoa                    ││
│  └─────────────────────────────┘│
│                                 │
└─────────────────────────────────┘
```

**Behavior:**
- Guarded reload on switch with save/discard prompt for unsaved work
- No cross-facility search (strict isolation)
- Search available within switcher

---

## 6. Compliance & Audit

### 6.1 Audit Log View

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Audit Log: Organization Structure                                      │
│  City General Hospital                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─ Filters ───────────────────────────────────────────────────────────┐│
│  │ Date: [ Last 30 days ▼ ]  User: [ All users ▼ ]  Action: [ All ▼ ] ││
│  │                                                              [Apply]││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Log Entries ───────────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  Mar 15, 2024 • 14:32                                               ││
│  │  ┌──────────────────────────────────────────────────────────────┐   ││
│  │  │ 📋 Structure Published                        Dr. K. Asante  │   ││
│  │  │                                                              │   ││
│  │  │ Changes: 12 modifications                                    │   ││
│  │  │ Reason: "Reorganizing surgery department after Dr. Osei     │   ││
│  │  │         joined as head of Orthopedics..."                   │   ││
│  │  │                                                              │   ││
│  │  │ [View Full Diff]                                             │   ││
│  │  └──────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  │  Mar 14, 2024 • 09:15                                               ││
│  │  ┌──────────────────────────────────────────────────────────────┐   ││
│  │  │ ✏️ Draft Modified                              Dr. K. Asante  │   ││
│  │  │                                                              │   ││
│  │  │ Action: Added unit "Gastroenterology" under Internal Med    │   ││
│  │  │                                                              │   ││
│  │  │ [View Details]                                               │   ││
│  │  └──────────────────────────────────────────────────────────────┘   ││
│  │                                                                     ││
│  │  ─────────────────────────────────────────────────────────────────  ││
│  │  Showing 1-20 of 156 entries                    [ ← ] [ 1 ] [ → ]  ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│                                                        [↓ Export CSV]   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Audit log features:**
- Compliance-grade (full diff + reason + user)
- Filterable by date, user, action type
- View full diff for any change
- CSV export for compliance reporting

---

## 7. Granular Permissions

### 7.1 Permission Configuration UI

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Permissions: Facility Administrator                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─ Scope ─────────────────────────────────────────────────────────────┐│
│  │  Facility: [ City General Hospital ▼ ]                              ││
│  │            ☐ Apply to all facilities in network                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Organization Management ───────────────────────────────────────────┐│
│  │                                                                     ││
│  │  ☑ View organization structure                                      ││
│  │  ☑ Edit organization structure (draft)                              ││
│  │  ☑ Publish organization changes                                     ││
│  │  ☐ Delete organizational units                                      ││
│  │  ☑ Import/export via CSV                                            ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Staff Management ──────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  ☑ View staff assignments                                           ││
│  │  ☑ Assign staff to units                                            ││
│  │  ☑ Modify staff assignments                                         ││
│  │  ☐ Create user accounts                                             ││
│  │  ☐ Deactivate user accounts                                         ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Compliance & Audit ────────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  ☑ View audit logs                                                  ││
│  │  ☐ Export audit logs                                                ││
│  │  ☐ GDPR data management (erasure, export)                           ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─ Network Administration ────────────────────────────────────────────┐│
│  │                                                                     ││
│  │  ☐ Add new facilities                                               ││
│  │  ☐ Modify facility settings                                         ││
│  │  ☐ Deactivate facilities                                            ││
│  │  ☐ View network-wide dashboard                                      ││
│  │                                                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│                                            [ Cancel ]  [ Save Changes ] │
└─────────────────────────────────────────────────────────────────────────┘
```

**Permission categories:**
1. Organization Management
2. Staff Management
3. Compliance & Audit
4. Network Administration

---

## 8. Mobile Responsive Design

### 8.1 Org Tree on Mobile

```
┌─────────────────────────────────┐
│  ← Organization Structure       │
│                      [ Publish ]│
├─────────────────────────────────┤
│                                 │
│  ⚠️ 12 unpublished changes      │
│                                 │
│  🔍 Search units...             │
│                                 │
│  ┌─────────────────────────────┐│
│  │ 🏥 City General       [ ▼ ] ││
│  └─────────────────────────────┘│
│    ┌───────────────────────────┐│
│    │ 🚨 Emergency        (24)  ││
│    │                     [ > ] ││
│    └───────────────────────────┘│
│    ┌───────────────────────────┐│
│    │ 🩺 Internal Med ◀   (18)  ││
│    │                     [ ▼ ] ││
│    └───────────────────────────┘│
│      ┌─────────────────────────┐│
│      │ Cardiology        (5)   ││
│      └─────────────────────────┘│
│      ┌─────────────────────────┐│
│      │ Pulmonology       (4)   ││
│      └─────────────────────────┘│
│    ...                          │
│                                 │
│  ─────────────────────────────  │
│  [ + Add Unit ]                 │
│                                 │
└─────────────────────────────────┘
```

**Accessibility note:**
- Provide Move Up/Down actions and keyboard-friendly reordering; drag-drop is optional

### 8.2 Unit Details (Bottom Sheet)

```
┌─────────────────────────────────┐
│  ━━━━━━━━━━━━━                  │  ← drag handle
├─────────────────────────────────┤
│                                 │
│  🩺 Internal Medicine           │
│                                 │
│  Code: MED                      │
│  Type: Department               │
│  Head: Dr. K. Mensah            │
│                                 │
│  ─────────────────────────────  │
│                                 │
│  CAPABILITIES                   │
│  ☑ Can admit    ☑ Has budget   │
│  ☑ Accepts ref  ☐ 24-hour      │
│                                 │
│  ─────────────────────────────  │
│                                 │
│  STAFF                          │
│  Doctors: 8  Nurses: 6          │
│  [Manage Staff →]               │
│                                 │
│  ─────────────────────────────  │
│                                 │
│  [ Edit ]        [ Delete ]     │
│                                 │
└─────────────────────────────────┘
```

---

## 9. Component Summary

| Component | Purpose | Key Features |
|-----------|---------|--------------|
| **Welcome Landing** | First impression | CTA, resume link, time estimate |
| **Setup Wizard** | Guided initial config | Auto-save, step indicator, templates |
| **Post-Setup Checklist** | Complete configuration | Categorized tasks, progress tracking |
| **Network Dashboard** | Multi-facility overview | Cards + map, configurable metrics |
| **Facility Switcher** | Change context | Header dropdown, full reload |
| **Org Tree Editor** | Structure management | Drag-drop, draft/publish, CSV import |
| **Publish Dialog** | Confirm changes | Diff view, reason field (audit) |
| **Deactivation Dialog** | Safe removal | Cascade options, reassignment |
| **Staff Assignment** | Bidirectional | From org or staff view |
| **Audit Log** | Compliance | Filters, diff view, export |
| **Permissions UI** | Granular access | Checkbox matrix, scoped |

---

## 10. Implementation Phases

### Phase 1: Foundation
- [ ] Welcome landing page
- [ ] Setup wizard (steps 1-5)
- [ ] Post-setup checklist
- [ ] Single facility support

### Phase 2: Multi-Facility
- [ ] Network dashboard (cards view)
- [ ] Add facility flow
- [ ] Facility switcher
- [ ] Map view toggle

### Phase 3: Organization Management
- [ ] Org tree editor (basic)
- [ ] Drag-drop reorganization
- [ ] Draft & publish workflow
- [ ] Add/edit/delete units

### Phase 4: Staff & Bulk Operations
- [ ] Staff assignment (bidirectional)
- [ ] CSV import/export
- [ ] Validation & preview

### Phase 5: Compliance & Polish
- [ ] Audit log view
- [ ] Granular permissions UI
- [ ] Deactivation cascade options
- [ ] Mobile responsive refinements

---

## 11. Technical Considerations

### State Management
- Wizard state: Backend draft + short-lived resume token in localStorage (no PHI)
- Org tree draft: Backend-stored draft per user/facility
- Facility context: Global state with URL sync

### Backend Requirements (Missing Today)
- Facility lifecycle states: provisioning, ready, failed, suspended
- Facility access scoping: admins see all, others see assigned/primary only
- Org template catalog and preview endpoints (custom templates later)
- MFA enforcement for admin users (TOTP + WebAuthn, resident keys, recovery codes)
- Demo mode flag that blocks exports/interop and shows watermarks
- Setup wizard creates first admin and assigns primary facility

### API Endpoints Needed
```
POST   /api/setup/wizard/                    # Save wizard progress
GET    /api/setup/wizard/                    # Resume wizard
POST   /api/setup/complete/                  # Complete setup

GET    /api/facilities/                      # List facilities
POST   /api/facilities/                      # Create facility (returns provisioning_job_id)
GET    /api/facilities/:code/                # Facility details
PATCH  /api/facilities/:code/                # Update facility
GET    /api/facilities/:code/access/         # Facility access + membership summary

POST   /api/provisioning/facilities/         # Start provisioning job
GET    /api/provisioning/jobs/:id/           # Provisioning status/progress
POST   /api/provisioning/jobs/:id/retry/     # Retry failed job

GET    /api/setup/templates/                 # Org templates catalog
GET    /api/setup/templates/:id/preview/     # Template preview tree

GET    /api/organization/tree/               # Get org tree
GET    /api/organization/draft/              # Get draft changes
POST   /api/organization/draft/              # Save draft
POST   /api/organization/publish/            # Publish changes
DELETE /api/organization/draft/              # Discard draft

GET    /api/organization/units/:id/staff/    # Staff for unit
POST   /api/organization/units/:id/staff/    # Assign staff
POST   /api/organization/import/             # CSV import
GET    /api/organization/export/             # CSV export

GET    /api/audit/organization/              # Audit log
GET    /api/audit/organization/:id/diff/     # Change diff

POST   /api/auth/2fa/enroll/                 # Admin MFA enrollment (TOTP)
POST   /api/auth/2fa/verify/                 # Verify TOTP setup
POST   /api/auth/2fa/recovery/               # Recovery code usage
GET    /api/auth/2fa/status/                 # MFA status (enforced for admins)
POST   /api/auth/webauthn/options/           # Begin WebAuthn registration
POST   /api/auth/webauthn/register/          # Complete WebAuthn registration
POST   /api/auth/webauthn/assertion/         # WebAuthn assertion (step-up)

GET    /api/system/mode/                     # Demo/prod mode flags
POST   /api/system/mode/                     # Admin‑only toggle (if allowed)
```

### Performance Considerations
- Org tree: Virtual scrolling for large trees (1000+ units)
- Network dashboard: Lazy load facility metrics
- Audit log: Paginated with filters applied server-side
- CSV import: Chunked upload for large files

---

## 12. Open Questions

1. **Template Management**: Approved for later versions (custom templates allowed post‑MVP).

2. **Offline Support**: Should the org tree editor work offline with sync?

3. **Bulk Staff Assignment**: Should CSV import support staff assignments, not just org structure?

4. **Change Scheduling**: Should draft changes be schedulable for future effective dates?

5. **Multi-Language**: Which languages need to be supported for the setup wizard?
6. **SSO**: Planned for a later phase (SAML/OIDC), not in initial setup.
