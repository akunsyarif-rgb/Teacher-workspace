import * as classFundService from '../services/classFundService';
import { withCache, clearAllCached } from '../utils/sessionCache';

export function classFundCacheKey(workspaceId: string, className: string) {
  return `classFund:${workspaceId}:${className}`;
}

export async function fetchClassFundData(workspaceId: string, className: string) {
  if (!workspaceId || !className) return { transactions: [], balance: 0 };
  return withCache(classFundCacheKey(workspaceId, className), () =>
    classFundService.loadClassFundData(workspaceId, className)
  );
}

export async function submitClassFundTransaction(
  workspaceId: string,
  className: string,
  data: { type: 'masuk' | 'keluar'; amount: number; description: string }
) {
  const result = await classFundService.addTransaction(workspaceId, className, data);
  clearAllCached();
  return result;
}

export async function deleteClassFundTransaction(id: string) {
  const result = await classFundService.removeTransaction(id);
  clearAllCached();
  return result;
}
