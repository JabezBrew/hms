import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function WardBedLayout({ beds, admissions, onBedClick, wardId }) {
  // Filter beds for the specific ward
  const filteredBeds = beds.filter(bed => bed.ward === wardId);

  // Calculate grid dimensions
  const totalBeds = filteredBeds.length;
  const preferredCols = Math.ceil(Math.sqrt(totalBeds * 2));
  const preferredRows = Math.ceil(totalBeds / preferredCols);

  const bedGrid = {};

  // Initialize the grid with empty cells
  for (let y = 0; y < preferredRows; y++) {
    bedGrid[y] = {};
    for (let x = 0; x < preferredCols; x++) {
      bedGrid[y][x] = null;
    }
  }

  // Place beds in the grid in a left-to-right, top-to-bottom manner
  filteredBeds.forEach((bed, index) => {
    const y = Math.floor(index / preferredCols);
    const x = index % preferredCols;
    bedGrid[y][x] = bed;
  });

  // Set maxX and maxY for rendering
  const maxX = preferredCols - 1;
  const maxY = preferredRows - 1;

  // Get status color for a bed
  const getStatusColor = (status) => {
    switch (status) {
      case 'available':
        return 'bg-green-100 border-green-500 text-green-700';
      case 'occupied':
        return 'bg-red-100 border-red-500 text-red-700';
      case 'reserved':
        return 'bg-yellow-100 border-yellow-500 text-yellow-700';
      case 'maintenance':
        return 'bg-gray-100 border-gray-500 text-gray-700';
      default:
        return 'bg-gray-100 border-gray-500 text-gray-700';
    }
  };

  // Get patient info for a bed
  const getPatientInfo = (bedId) => {
    const activeAdmission = admissions.find(
      admission => admission.bed.id === bedId && admission.status === 'admitted'
    );

    if (activeAdmission) {
      return {
        name: activeAdmission.patient.user.full_name,
        admissionDate: new Date(activeAdmission.admission_date).toLocaleDateString(),
        admissionId: activeAdmission.id
      };
    }

    return null;
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="overflow-auto">
          <div className="min-w-[600px]">
            {/* Ward layout grid */}
            <div className="grid gap-4" style={{ gridTemplateRows: `repeat(${maxY + 1}, 1fr)` }}>
              {Array.from({ length: maxY + 1 }).map((_, y) => (
                <div 
                  key={y} 
                  className="grid gap-4" 
                  style={{ gridTemplateColumns: `repeat(${maxX + 1}, 1fr)` }}
                >
                  {Array.from({ length: maxX + 1 }).map((_, x) => {
                    const bed = bedGrid[y][x];

                    if (!bed) {
                      // Empty cell
                      return <div key={x} className="h-24 w-full"></div>;
                    }

                    const patientInfo = getPatientInfo(bed.id);

                    return (
                      <TooltipProvider key={x}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div 
                              className={`h-24 w-full border-2 rounded-md p-2 flex flex-col justify-between cursor-pointer hover:shadow-md transition-shadow ${getStatusColor(bed.status)}`}
                              onClick={() => onBedClick(bed.id)}
                            >
                              <div className="flex justify-between items-start">
                                <span className="font-bold">{bed.bed_number}</span>
                              </div>

                              {patientInfo && (
                                <div className="text-xs truncate">
                                  {patientInfo.name}
                                </div>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="p-2">
                              <p className="font-bold">Bed {bed.bed_number}</p>
                              <p>Type: {bed.bed_type}</p>
                              <p>Status: {bed.status}</p>
                              <p>Rate: ${bed.total_rate}/night</p>

                              {patientInfo && (
                                <>
                                  <div className="border-t my-2"></div>
                                  <p className="font-bold">Patient: {patientInfo.name}</p>
                                  <p>Admitted: {patientInfo.admissionDate}</p>
                                </>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="mt-6 flex flex-wrap gap-4">
              <div className="flex items-center">
                <div className="w-4 h-4 bg-green-100 border border-green-500 rounded mr-2"></div>
                <span className="text-sm">Available</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-red-100 border border-red-500 rounded mr-2"></div>
                <span className="text-sm">Occupied</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-yellow-100 border border-yellow-500 rounded mr-2"></div>
                <span className="text-sm">Reserved</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-gray-100 border border-gray-500 rounded mr-2"></div>
                <span className="text-sm">Maintenance</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
