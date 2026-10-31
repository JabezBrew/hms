import { displayText } from './model';
export const itemName = item => displayText(item?.name) === 'Not recorded' ? 'Unnamed catalog item' : item.name;
export const itemCode = item => displayText(item?.code);
export const categoryName = item => item?.category ? displayText(item.category.name) : 'Category unavailable';
const classifications = new Map([['medication', 'Medication'], ['supply', 'Supply'], ['controlled_substance', 'Controlled substance']]);
export const classification = item => classifications.get(item?.item_type) || 'Unsupported classification';
export const blockerCopy = (blocker, action) => blocker === 'operational_reference'
  ? `This item has linked records and cannot ${action} here. Zero stock or completed work does not remove linked records.`
  : blocker === 'controlled_or_unsupported' ? 'This classification cannot change active state or stock unit in this workflow.' : null;
