import React from 'react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import {
  Bed,
  User,
  Calendar,
  Clock,
  Wrench,
  AlertCircle,
  ChevronRight,
  Users,
  Home,
  Shield,
  Sparkles
} from 'lucide-react';
import { useWardSections } from '@/hooks/useWardQueries';

/**
 * WardBedLayout - Chronicle-style bed visualization
 *
 * Features:
 * - Grid view: Visual bed icons with status colors
 * - List view: Detailed rows with patient info
 * - Section grouping with headers
 * - Elegant hover effects and animations
 * - Status-based color coding
 */
export function WardBedLayout({ beds, admissions, onBedClick, wardId, viewMode = 'grid' }) {
  // Filter beds for this ward (in case not pre-filtered)
  const wardBeds = beds.filter(bed => bed.ward === wardId || !wardId);

  // Fetch sections for the ward
  const { data: sections = [], isLoading: sectionsLoading } = useWardSections(wardId, {
    enabled: !!wardId,
  });

  // Group beds by section
  const bedsBySection = React.useMemo(() => {
    const grouped = {};

    wardBeds.forEach(bed => {
      const sectionId = bed.section || 'unassigned';
      if (!grouped[sectionId]) {
        grouped[sectionId] = [];
      }
      grouped[sectionId].push(bed);
    });

    // Sort sections by display_order
    const sortedGroups = {};
    sections
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
      .forEach(section => {
        if (grouped[section.id]) {
          sortedGroups[section.id] = grouped[section.id];
        }
      });

    // Add unassigned beds at the end
    if (grouped.unassigned) {
      sortedGroups.unassigned = grouped.unassigned;
    }

    return sortedGroups;
  }, [wardBeds, sections]);

  // Get section details by ID
  const getSectionDetails = (sectionId) => {
    if (sectionId === 'unassigned') {
      return { id: 'unassigned', name: 'Unassigned Beds', is_active: true };
    }
    return sections.find(s => s.id === sectionId);
  };

  // Get patient info for a bed
  const getPatientInfo = (bedId) => {
    const activeAdmission = admissions.find(
      admission => admission.bed?.id === bedId && admission.status === 'admitted'
    );

    if (activeAdmission) {
      return {
        name: activeAdmission.patient?.user?.full_name || activeAdmission.patient?.full_name || 'Patient',
        admissionDate: activeAdmission.admission_date,
        admissionId: activeAdmission.id,
        diagnosis: activeAdmission.diagnosis || activeAdmission.reason_for_admission,
        daysAdmitted: getDaysAdmitted(activeAdmission.admission_date)
      };
    }

    return null;
  };

  // Calculate days admitted
  const getDaysAdmitted = (admissionDate) => {
    if (!admissionDate) return 0;
    const admission = new Date(admissionDate);
    const today = new Date();
    const diffTime = Math.abs(today - admission);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // Status configuration
  const statusConfig = {
    available: {
      label: 'Available',
      color: 'emerald',
      bgClass: 'bg-emerald-500/10 hover:bg-emerald-500/20',
      borderClass: 'border-emerald-500/30 hover:border-emerald-500',
      textClass: 'text-emerald-600',
      iconClass: 'text-emerald-500',
      icon: Bed
    },
    occupied: {
      label: 'Occupied',
      color: 'rose',
      bgClass: 'bg-rose-500/10 hover:bg-rose-500/20',
      borderClass: 'border-rose-500/30 hover:border-rose-500',
      textClass: 'text-rose-600',
      iconClass: 'text-rose-500',
      icon: User
    },
    reserved: {
      label: 'Reserved',
      color: 'amber',
      bgClass: 'bg-amber-500/10 hover:bg-amber-500/20',
      borderClass: 'border-amber-500/30 hover:border-amber-500',
      textClass: 'text-amber-600',
      iconClass: 'text-amber-500',
      icon: Clock
    },
    maintenance: {
      label: 'Maintenance',
      color: 'slate',
      bgClass: 'bg-slate-500/10 hover:bg-slate-500/20',
      borderClass: 'border-slate-500/30 hover:border-slate-500',
      textClass: 'text-slate-500',
      iconClass: 'text-slate-400',
      icon: Wrench
    }
  };

  // Bed type labels
  const bedTypeLabels = {
    'standard': 'Standard',
    'icu': 'ICU',
    'pediatric': 'Pediatric',
    'bariatric': 'Bariatric',
    'maternity': 'Maternity',
    'electric': 'Electric',
    'manual': 'Manual'
  };

  if (viewMode === 'list') {
    return (
      <ListView
        bedsBySection={bedsBySection}
        getSectionDetails={getSectionDetails}
        statusConfig={statusConfig}
        bedTypeLabels={bedTypeLabels}
        getPatientInfo={getPatientInfo}
        formatDate={formatDate}
        onBedClick={onBedClick}
      />
    );
  }

  return (
    <GridView
      bedsBySection={bedsBySection}
      getSectionDetails={getSectionDetails}
      statusConfig={statusConfig}
      bedTypeLabels={bedTypeLabels}
      getPatientInfo={getPatientInfo}
      formatDate={formatDate}
      onBedClick={onBedClick}
    />
  );
}

/**
 * SectionHeader - Section title with metadata
 */
function SectionHeader({ section }) {
  if (!section) return null;

  // Get icon for accommodation tier
  const getTierIcon = (tier) => {
    switch (tier) {
      case 'vip':
        return <Sparkles className="h-4 w-4" />;
      case 'private':
        return <Home className="h-4 w-4" />;
      case 'semi_private':
        return <Users className="h-4 w-4" />;
      default:
        return null;
    }
  };

  // Get color for accommodation tier
  const getTierColor = (tier) => {
    switch (tier) {
      case 'vip':
        return 'text-amber-600 bg-amber-50 border-amber-200';
      case 'private':
        return 'text-sky-600 bg-sky-50 border-sky-200';
      case 'semi_private':
        return 'text-emerald-600 bg-emerald-50 border-emerald-200';
      case 'open':
        return 'text-stone-600 bg-stone-50 border-stone-200';
      default:
        return 'text-stone-600 bg-stone-50 border-stone-200';
    }
  };

  const isUnassigned = section.id === 'unassigned';

  return (
    <div className="flex items-center gap-3 pb-4 mb-6 border-b border-border/50">
      {/* Section name with tier icon */}
      <div className="flex items-center gap-2">
        {!isUnassigned && getTierIcon(section.accommodation_tier)}
        <h3 className="font-heading text-xl font-semibold text-foreground">
          {section.name}
        </h3>
      </div>

      {/* Badges */}
      {!isUnassigned && (
        <div className="flex items-center gap-2">
          {/* Accommodation tier badge */}
          <Badge
            variant="outline"
            className={cn('text-xs capitalize', getTierColor(section.accommodation_tier))}
          >
            {section.accommodation_tier?.replace('_', ' ')}
          </Badge>

          {/* Gender restriction badge */}
          {section.gender_restriction === 'male_only' && (
            <Badge variant="outline" className="text-xs text-sky-700 bg-sky-50 border-sky-200">
              Male Only
            </Badge>
          )}
          {section.gender_restriction === 'female_only' && (
            <Badge variant="outline" className="text-xs text-rose-700 bg-rose-50 border-rose-200">
              Female Only
            </Badge>
          )}

          {/* Isolation capability */}
          {section.is_isolation_capable && (
            <Badge variant="outline" className="text-xs">
              <Shield className="h-3 w-3 mr-1" />
              Isolation
            </Badge>
          )}
        </div>
      )}

      {/* Bed count */}
      <span className="ml-auto font-mono text-sm text-muted-foreground">
        {section.bed_count || section.available_beds_count || 0} beds
      </span>
    </div>
  );
}

/**
 * GridView - Visual bed grid with icons
 */
function GridView({ bedsBySection, getSectionDetails, statusConfig, bedTypeLabels, getPatientInfo, formatDate, onBedClick }) {
  return (
    <div className="space-y-8">
      {/* Iterate through sections */}
      {Object.entries(bedsBySection).map(([sectionId, beds]) => {
        const section = getSectionDetails(sectionId);
        if (!section) return null;

        return (
          <div key={sectionId} className="space-y-4">
            {/* Section Header */}
            <SectionHeader section={section} />

            {/* Beds Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {beds.map((bed) => {
                const config = statusConfig[bed.status] || statusConfig.available;
                const StatusIcon = config.icon;
                const patientInfo = getPatientInfo(bed.id);

                return (
                  <TooltipProvider key={bed.id}>
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <div
                          onClick={() => onBedClick(bed.id)}
                          className={cn(
                            "relative rounded-xl border-2 p-4 cursor-pointer transition-all duration-200",
                            "hover:shadow-lg hover:-translate-y-0.5",
                            config.bgClass,
                            config.borderClass
                          )}
                        >
                          {/* Bed Icon & Number */}
                          <div className="flex items-start justify-between mb-3">
                            <div className={cn("p-2 rounded-lg", `bg-${config.color}-500/20`)}>
                              <Bed className={cn("h-5 w-5", config.iconClass)} />
                            </div>
                            <span className={cn(
                              "font-mono text-lg font-bold",
                              config.textClass
                            )}>
                              {bed.bed_number}
                            </span>
                          </div>

                          {/* Status & Type */}
                          <div className="space-y-1">
                            <div className={cn(
                              "flex items-center gap-1.5",
                              config.textClass
                            )}>
                              <StatusIcon className="h-3.5 w-3.5" />
                              <span className="font-mono text-xs font-medium">
                                {config.label}
                              </span>
                            </div>
                            <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                              {bedTypeLabels[bed.bed_type] || bed.bed_type}
                            </p>
                          </div>

                          {/* Patient Preview (for occupied beds) */}
                          {patientInfo && (
                            <div className="mt-3 pt-3 border-t border-border/50">
                              <p className="text-sm font-medium text-foreground truncate">
                                {patientInfo.name}
                              </p>
                              <p className="font-mono text-[10px] text-muted-foreground">
                                Day {patientInfo.daysAdmitted}
                              </p>
                            </div>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs p-0">
                        <BedTooltip
                          bed={bed}
                          config={config}
                          bedTypeLabels={bedTypeLabels}
                          patientInfo={patientInfo}
                          formatDate={formatDate}
                        />
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-6 py-4 border-t border-border/50">
        {Object.entries(statusConfig).map(([status, config]) => (
          <div key={status} className="flex items-center gap-2">
            <div className={cn(
              "w-3 h-3 rounded-full",
              `bg-${config.color}-500`
            )} />
            <span className="font-mono text-xs text-muted-foreground">
              {config.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * ListView - Detailed table-like list
 */
function ListView({ bedsBySection, getSectionDetails, statusConfig, bedTypeLabels, getPatientInfo, formatDate, onBedClick }) {
  return (
    <div className="space-y-8">
      {/* Iterate through sections */}
      {Object.entries(bedsBySection).map(([sectionId, beds]) => {
        const section = getSectionDetails(sectionId);
        if (!section) return null;

        return (
          <div key={sectionId} className="space-y-4">
            {/* Section Header */}
            <SectionHeader section={section} />

            {/* Beds List */}
            <div className="space-y-2">
              {beds.map((bed) => {
                const config = statusConfig[bed.status] || statusConfig.available;
                const StatusIcon = config.icon;
                const patientInfo = getPatientInfo(bed.id);

                return (
                  <div
                    key={bed.id}
                    onClick={() => onBedClick(bed.id)}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all",
                      "hover:shadow-md hover:border-border",
                      "bg-card/50 border-border/50"
                    )}
                  >
                    {/* Bed Icon */}
                    <div className={cn(
                      "p-3 rounded-xl shrink-0",
                      config.bgClass
                    )}>
                      <Bed className={cn("h-5 w-5", config.iconClass)} />
                    </div>

                    {/* Bed Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-lg font-bold text-foreground">
                          Bed {bed.bed_number}
                        </span>
                        <span className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono",
                          config.bgClass,
                          config.textClass
                        )}>
                          <StatusIcon className="h-3 w-3" />
                          {config.label}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground uppercase">
                          {bedTypeLabels[bed.bed_type] || bed.bed_type}
                        </span>
                      </div>

                      {/* Patient Info */}
                      {patientInfo ? (
                        <div className="flex items-center gap-4 mt-1.5">
                          <div className="flex items-center gap-1.5 text-sm text-foreground">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{patientInfo.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {formatDate(patientInfo.admissionDate)}
                          </div>
                          <div className="font-mono text-xs text-muted-foreground">
                            Day {patientInfo.daysAdmitted}
                          </div>
                          {patientInfo.diagnosis && (
                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {patientInfo.diagnosis}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground mt-1">
                          {bed.status === 'available' && 'Ready for admission'}
                          {bed.status === 'reserved' && 'Reserved for incoming patient'}
                          {bed.status === 'maintenance' && 'Under maintenance'}
                        </p>
                      )}
                    </div>

                    {/* Rate */}
                    {bed.total_rate && (
                      <div className="text-right shrink-0">
                        <p className="font-mono text-sm font-medium text-foreground">
                          ${bed.total_rate}
                        </p>
                        <p className="font-mono text-[10px] text-muted-foreground uppercase">
                          per night
                        </p>
                      </div>
                    )}

                    {/* Arrow */}
                    <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * BedTooltip - Rich tooltip content for beds
 */
function BedTooltip({ bed, config, bedTypeLabels, patientInfo, formatDate }) {
  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-mono font-bold text-foreground">
            Bed {bed.bed_number}
          </h4>
          <p className="font-mono text-xs text-muted-foreground">
            {bedTypeLabels[bed.bed_type] || bed.bed_type}
          </p>
        </div>
        <span className={cn(
          "px-2 py-1 rounded-full text-xs font-mono",
          config.bgClass,
          config.textClass
        )}>
          {config.label}
        </span>
      </div>

      {/* Rate */}
      {bed.total_rate && (
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-lg font-bold text-foreground">
            ${bed.total_rate}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            /night
          </span>
        </div>
      )}

      {/* Patient Info */}
      {patientInfo && (
        <div className="pt-3 border-t border-border space-y-2">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-foreground">
              {patientInfo.name}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            Admitted {formatDate(patientInfo.admissionDate)}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-amber-600">
              Day {patientInfo.daysAdmitted}
            </span>
          </div>
          {patientInfo.diagnosis && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="line-clamp-2">{patientInfo.diagnosis}</span>
            </div>
          )}
        </div>
      )}

      {/* Click hint */}
      <p className="font-mono text-[10px] text-muted-foreground text-center pt-2">
        Click to {patientInfo ? 'view admission' : 'view details'}
      </p>
    </div>
  );
}
