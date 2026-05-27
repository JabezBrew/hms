export function getSectionName(section = {}, index = 0) {
  return section.section || section.name || `Section ${index + 1}`;
}
