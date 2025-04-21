import { Card, CardContent } from '@/components/ui/card';

export function WardOccupancyStats({ totalBeds, availableBeds, occupancyRate }) {
  // Calculate occupied beds
  const occupiedBeds = totalBeds - availableBeds;
  
  // Determine occupancy status color
  const getOccupancyColor = (rate) => {
    if (rate < 70) return 'text-green-600';
    if (rate < 90) return 'text-yellow-600';
    return 'text-red-600';
  };
  
  // Format occupancy rate
  const formattedRate = occupancyRate.toFixed(1);
  
  return (
    <Card>
      <CardContent className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Total Beds */}
          <div className="flex flex-col items-center justify-center p-4 border rounded-md">
            <span className="text-sm text-muted-foreground">Total Beds</span>
            <span className="text-3xl font-bold">{totalBeds}</span>
          </div>
          
          {/* Available Beds */}
          <div className="flex flex-col items-center justify-center p-4 border rounded-md">
            <span className="text-sm text-muted-foreground">Available</span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-green-600">{availableBeds}</span>
              <span className="text-sm text-muted-foreground">beds</span>
            </div>
          </div>
          
          {/* Occupancy Rate */}
          <div className="flex flex-col items-center justify-center p-4 border rounded-md">
            <span className="text-sm text-muted-foreground">Occupancy Rate</span>
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-bold ${getOccupancyColor(occupancyRate)}`}>
                {formattedRate}%
              </span>
              <span className="text-sm text-muted-foreground">
                ({occupiedBeds}/{totalBeds})
              </span>
            </div>
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="mt-4">
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div 
              className={`h-2.5 rounded-full ${getOccupancyColor(occupancyRate).replace('text-', 'bg-')}`}
              style={{ width: `${Math.min(100, occupancyRate)}%` }}
            ></div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}