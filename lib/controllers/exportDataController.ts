import * as exportDataService from '../services/exportDataService';
import { DateRange } from '../utils/periodRange';
import type { ExportScope } from '../services/exportDataService';

export type { ExportScope };

export async function fetchExportData(
  workspaceId: string,
  dataTypeKeys: string[],
  range: DateRange,
  scope: ExportScope
) {
  return exportDataService.gatherExportData(workspaceId, dataTypeKeys, range, scope);
}
