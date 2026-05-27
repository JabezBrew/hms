/**
 * Utility functions for Duty Roster Management
 */

/**
 * Safely convert API response to list
 */
export const toList = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload?.results || payload?.data?.results || [];
};

/**
 * Flatten unit tree to flat list
 */
export const flattenUnitTree = (nodes, parentId = null, parentName = null, results = []) => {
  if (!Array.isArray(nodes)) return results;
  nodes.forEach((node) => {
    results.push({
      id: node.id,
      name: node.name,
      code: node.code,
      unit_type_code: node.unit_type_code,
      unit_type_name: node.unit_type_name,
      unit_category: node.unit_category,
      staffing_mode: node.staffing_mode,
      parentId,
      parentName,
    });
    if (node.children && node.children.length) {
      flattenUnitTree(node.children, node.id, node.name, results);
    }
  });
  return results;
};
