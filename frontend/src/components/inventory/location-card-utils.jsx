import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Warehouse from 'lucide-react/dist/esm/icons/warehouse.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import Bed from 'lucide-react/dist/esm/icons/bed-double.js';
import Thermometer from 'lucide-react/dist/esm/icons/thermometer.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import Snowflake from 'lucide-react/dist/esm/icons/snowflake.js';

const USD_COMPACT_CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const US_NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

const LOCATION_TYPES = {
  warehouse: {
    label: 'Warehouse',
    icon: Warehouse,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
  },
  pharmacy: {
    label: 'Pharmacy',
    icon: Pill,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
  },
  ward: {
    label: 'Ward',
    icon: Bed,
    color: 'text-sky-500',
    bgColor: 'bg-sky-500/10',
    borderColor: 'border-sky-500/30',
  },
  department: {
    label: 'Department',
    icon: Building2,
    color: 'text-violet-500',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/30',
  },
  store: {
    label: 'Store',
    icon: Package,
    color: 'text-rose-500',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/30',
  },
};

const TEMP_ZONES = {
  ambient: {
    label: 'Ambient',
    icon: Thermometer,
    color: 'text-muted-foreground',
    range: '15-25°C',
  },
  cold: {
    label: 'Cold Storage',
    icon: Snowflake,
    color: 'text-sky-500',
    range: '2-8°C',
  },
  frozen: {
    label: 'Frozen',
    icon: Snowflake,
    color: 'text-cyan-500',
    range: '-20°C',
  },
  controlled: {
    label: 'Controlled',
    icon: Thermometer,
    color: 'text-amber-500',
    range: 'Variable',
  },
};

export function getLocationConfig(type) {
  return LOCATION_TYPES[type?.toLowerCase()] || {
    label: type || 'Location',
    icon: MapPin,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50',
    borderColor: 'border-border',
  };
}

export function getTempZoneConfig(zone) {
  return TEMP_ZONES[zone?.toLowerCase()] || null;
}

export function formatLocationCurrency(amount) {
  return USD_COMPACT_CURRENCY_FORMATTER.format(amount || 0);
}

export function formatLocationNumber(value) {
  return US_NUMBER_FORMATTER.format(value || 0);
}
