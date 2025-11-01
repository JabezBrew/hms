import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';

export function WardFilterBar({ filters, onFilterChange }) {
  const [localFilters, setLocalFilters] = useState({
    status: filters.status || 'all',
    bedType: filters.bedType || 'all',
    searchTerm: filters.searchTerm || '',
  });

  // Handle input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setLocalFilters(prev => ({ ...prev, [name]: value }));
  };

  // Handle select changes
  const handleSelectChange = (name, value) => {
    setLocalFilters(prev => ({ ...prev, [name]: value }));
    onFilterChange({ [name]: value });
  };

  // Handle search
  const handleSearch = () => {
    onFilterChange({ searchTerm: localFilters.searchTerm });
  };

  // Handle search on enter key
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // Clear all filters
  const clearFilters = () => {
    const resetFilters = {
      status: 'all',
      bedType: 'all',
      searchTerm: '',
    };
    setLocalFilters(resetFilters);
    onFilterChange(resetFilters);
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Status filter */}
          <div className="space-y-2">
            <Label htmlFor="status">Bed Status</Label>
            <Select
              value={localFilters.status}
              onValueChange={(value) => handleSelectChange('status', value)}
            >
              <SelectTrigger id="status">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="occupied">Occupied</SelectItem>
                <SelectItem value="reserved">Reserved</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Bed type filter */}
          <div className="space-y-2">
            <Label htmlFor="bedType">Bed Type</Label>
            <Select
              value={localFilters.bedType}
              onValueChange={(value) => handleSelectChange('bedType', value)}
            >
              <SelectTrigger id="bedType">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="standard">Standard Bed</SelectItem>
                <SelectItem value="icu">ICU Bed</SelectItem>
                <SelectItem value="pediatric">Pediatric Bed</SelectItem>
                <SelectItem value="bariatric">Bariatric Bed</SelectItem>
                <SelectItem value="maternity">Maternity Bed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Search input */}
          <div className="space-y-2">
            <Label htmlFor="searchTerm">Search Bed Number</Label>
            <div className="flex">
              <Input
                id="searchTerm"
                name="searchTerm"
                value={localFilters.searchTerm}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Search..."
                className="rounded-r-none"
              />
              <Button 
                type="button" 
                onClick={handleSearch}
                variant="secondary"
                className="rounded-l-none"
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Clear filters button */}
          <div className="flex items-end">
            <Button 
              variant="outline" 
              className="w-full"
              onClick={clearFilters}
            >
              <X className="h-4 w-4 mr-2" />
              Clear Filters
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
