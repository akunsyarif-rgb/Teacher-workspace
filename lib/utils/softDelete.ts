// Soft delete (TD-001): dokumen yang dihapus hanya diberi `deletedAt` (+ deletedBy,
// deletedBatchId bila dihapus massal sebagai satu kelas). Semua pembacaan
// repository menyaring lewat sini. Penyaringan dilakukan di sisi aplikasi, bukan
// `where('deletedAt','==',null)`: Firestore tidak mencocokkan dokumen yang field-nya
// TIDAK ADA, sehingga seluruh data lama (tanpa field itu) akan hilang dari query.
export function isDeleted(doc: unknown): boolean {
  return !!doc && typeof doc === 'object' && !!(doc as { deletedAt?: unknown }).deletedAt;
}

export function activeOnly<T extends object>(docs: T[]): T[] {
  return docs.filter((d) => !isDeleted(d));
}

export function deletedOnly<T extends object>(docs: T[]): T[] {
  return docs.filter((d) => isDeleted(d));
}
