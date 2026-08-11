import * as sessionSkipReasonService from '../services/sessionSkipReasonService';
import { clearAllCached } from '../utils/sessionCache';

export async function submitSkipReason(
  workspaceId: string,
  scheduleId: string,
  className: string,
  reason: string,
  note: string
) {
  const result = await sessionSkipReasonService.saveSkipReason(workspaceId, scheduleId, className, reason, note);
  // Beranda meng-cache dashboardSummary (TTL 15s) — hapus supaya sesi yang
  // baru dikonfirmasi langsung tampil alasannya, bukan menunggu TTL habis.
  clearAllCached();
  return result;
}
