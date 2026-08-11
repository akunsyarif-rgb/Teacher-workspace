import * as inventoryService from '../services/inventoryService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export { CONDITION_OPTIONS } from '../services/inventoryService';
export type { ConditionOption } from '../services/inventoryService';

export function inventoryCacheKey(workspaceId: string, className: string) {
  return `inventory:${workspaceId}:${className}`;
}

export async function fetchInventoryItems(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return withCache(inventoryCacheKey(workspaceId, className), () => inventoryService.loadItems(workspaceId, className));
}

export async function submitInventoryItem(
  workspaceId: string,
  className: string,
  data: { name: string; quantity: number; condition: string; note?: string }
) {
  const result = await inventoryService.addItem(workspaceId, className, data as any);
  clearAllCached();
  return result;
}

export async function updateInventoryItemCondition(id: string, condition: string) {
  const result = await inventoryService.updateItemCondition(id, condition as any);
  clearAllCached();
  return result;
}

export async function deleteInventoryItem(id: string) {
  const result = await inventoryService.removeItem(id);
  clearAllCached();
  return result;
}
