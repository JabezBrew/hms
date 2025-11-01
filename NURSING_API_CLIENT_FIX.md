# Nursing Dashboard API Client Fix

## The Real Problem

The nursing dashboard was empty because of how the API client handles paginated responses.

### Root Cause

In `frontend/src/lib/api-client.js`, the `apiClient.get()` method automatically extracts the `results` array from paginated responses:

```javascript
get: async (endpoint, options = {}) => {
  const response = await fetchWithAuth(endpoint, { ...options, method: 'GET' });
  return handlePaginatedResponse(response);  // <-- Auto-extracts 'results'
},
```

The `handlePaginatedResponse` function:

```javascript
function handlePaginatedResponse(response) {
  // Check if the response is paginated (has a 'results' property)
  if (response && typeof response === 'object' && Array.isArray(response.results)) {
    return response.results;  // <-- Returns ONLY the results array
  }
  return response;
}
```

### What Was Happening

1. **Backend sends:**
   ```json
   {
     "count": 1,
     "page": 1,
     "page_size": 20,
     "total_pages": 1,
     "results": [{ patient: {...}, admission: {...} }]
   }
   ```

2. **apiClient.get() returns:**
   ```json
   [{ patient: {...}, admission: {...} }]
   ```
   *(Just the results array, not the full paginated object)*

3. **Frontend tries to access:**
   ```javascript
   const monitoringData = monitoringResponse?.results || [];  // undefined!
   const totalCount = monitoringResponse?.count || 0;         // undefined!
   ```

4. **Result:** Empty dashboard because `monitoringData` was undefined/empty

### The Fix

Changed from `apiClient.get()` to `apiClient.getWithPagination()` which returns the full response:

**Before:**
```javascript
const response = await apiClient.get(`/nursing/monitoring/dashboard/?${params.toString()}`);
// response = [...]  (just the array)
```

**After:**
```javascript
const data = await apiClient.getWithPagination(`/nursing/monitoring/dashboard/?${params.toString()}`);
// data = { count: 1, page: 1, page_size: 20, total_pages: 1, results: [...] }
```

## Files Modified

### 1. `frontend/src/hooks/useNursingQueries.js`

#### `usePatientMonitoring` Hook (Line 15-44)

**Changed:**
- Line 16: `apiClient.get()` → `apiClient.getWithPagination()`
- Line 16-18: `response.data` → `data` (getWithPagination returns data directly)
- Lines 21-44: Updated all references from `response.data` to `data`

**Before:**
```javascript
const response = await apiClient.get(`/nursing/monitoring/dashboard/?${params.toString()}`);
if (!response.data) { ... }
if (Array.isArray(response.data)) { ... }
return response.data;
```

**After:**
```javascript
const data = await apiClient.getWithPagination(`/nursing/monitoring/dashboard/?${params.toString()}`);
if (!data) { ... }
if (Array.isArray(data)) { ... }
return data;
```

#### `useActiveAlerts` Hook (Line 220-232)

**Changed:**
- Line 222: `apiClient.get()` → `apiClient.getWithPagination()`
- Lines 222-231: `response.data` → `data`

## Why This Happened

The `apiClient.get()` method was designed to simplify working with paginated Django REST Framework responses by automatically extracting the `results` array. This works great for endpoints where you only need the list of items (like fetching patients, appointments, etc.).

However, for the nursing dashboard, we need:
- `count` - total number of patients
- `page` - current page number
- `total_pages` - for pagination controls
- `results` - the actual patient data

So we need the **full paginated response**, not just the results array.

## API Client Methods Comparison

### `apiClient.get()`
- **Purpose:** Get data, auto-extract results if paginated
- **Returns:**
  - If paginated response: `[...]` (just the results array)
  - If non-paginated: the full response
- **Use when:** You only need the list of items, not pagination metadata

### `apiClient.getWithPagination()`
- **Purpose:** Get the full response including pagination metadata
- **Returns:** The complete response as-is
- **Use when:** You need pagination info (count, next, previous, page, etc.)

### `apiClient.getAll()`
- **Purpose:** Fetch ALL pages and combine results
- **Returns:** Combined array of all results from all pages
- **Use when:** You need all data regardless of pagination

## Testing the Fix

### Expected Console Output

After the fix, you should see:

```
Patient Monitoring API Response: {count: 1, page: 1, page_size: 20, total_pages: 1, results: Array(1)}
Response data type: object
Monitoring Response: {count: 1, page: 1, page_size: 20, total_pages: 1, results: Array(1)}
Monitoring Data: [{ patient: {...}, admission: {...}, ... }]
Total Count: 1
```

### Dashboard Should Show

✅ **Total Patients:** 1
✅ **Patient List:** Christie Tow (HMS-2025-02267)
✅ **Ward:** Surgical 2 - Bed 027
✅ **No errors** in console

## Lessons Learned

1. **Know your API client methods**: Different methods handle responses differently
2. **Check response structure**: Always log responses during development
3. **Read the API client code**: Understanding helper functions like `handlePaginatedResponse()` is crucial
4. **Use TypeScript**: Would have caught this with proper types
5. **Document API patterns**: This prevents confusion about when to use which method

## Related Issues

This same issue could affect other parts of the application that:
- Need pagination metadata
- Use `apiClient.get()` expecting the full paginated response
- Try to access `response.count`, `response.next`, `response.previous`, etc.

## Recommendation

Consider adding JSDoc comments to the API client methods to make the behavior clear:

```javascript
/**
 * Get data from endpoint
 * @param {string} endpoint - API endpoint path
 * @returns {Promise<Array|Object>} - If paginated, returns ONLY the results array
 *                                    If not paginated, returns the full response
 * @example
 * // For paginated endpoint /api/patients/ (returns {count: 10, results: [...]})
 * const patients = await apiClient.get('/patients/');
 * // patients = [...] (just the array, count is lost)
 */
get: async (endpoint, options = {}) => { ... }

/**
 * Get full response including pagination metadata
 * @param {string} endpoint - API endpoint path
 * @returns {Promise<Object>} - Complete response including count, next, previous, results
 * @example
 * // For paginated endpoint /api/patients/ (returns {count: 10, results: [...]})
 * const response = await apiClient.getWithPagination('/patients/');
 * // response = {count: 10, page: 1, results: [...]}
 */
getWithPagination: (endpoint, options = {}) => { ... }
```

## Summary

The fix was simple but the root cause was subtle:
- Used `getWithPagination()` instead of `get()` to preserve pagination metadata
- Updated variable names from `response.data` to `data` for clarity
- Now the full paginated response is available to the component

Dashboard should now display Christie Tow and all patient monitoring data correctly! 🎉
