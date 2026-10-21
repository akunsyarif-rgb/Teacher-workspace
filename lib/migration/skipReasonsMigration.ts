import { firestoreDocToRow as generic, reconcileCollection } from './collectionMigration';
export type { ReconcileReport } from './collectionMigration';

// Pembungkus kompatibel untuk koleksi percobaan pertama; logika umum ada di collectionMigration.ts.
const C = 'session_skip_reasons';
type Row = Record<string, unknown>;
export const firestoreDocToRow = (id: string, data: Row) => generic(C, id, data);
export const reconcileSkipReasons = (docs: { id: string; data: Row }[], rows: Row[]) => reconcileCollection(C, docs, rows);
