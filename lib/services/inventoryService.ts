import * as inventoryRepository from '../repositories/inventoryRepository';

export const CONDITION_OPTIONS = ['Baik', 'Rusak Ringan', 'Rusak Berat', 'Hilang'] as const;
export type ConditionOption = (typeof CONDITION_OPTIONS)[number];

export async function loadItems(workspaceId: string, className: string) {
  if (!workspaceId || !className) return [];
  return inventoryRepository.getItems(workspaceId, className);
}

export async function addItem(
  workspaceId: string,
  className: string,
  data: { name: string; quantity: number; condition: ConditionOption; note?: string }
) {
  if (!workspaceId || !className) throw new Error('Kelas tidak valid.');
  if (!data.name || !data.name.trim()) throw new Error('Nama barang wajib diisi.');
  if (!data.quantity || data.quantity <= 0) throw new Error('Jumlah harus lebih dari 0.');

  return inventoryRepository.createItem({
    workspaceId,
    className,
    name: data.name.trim(),
    quantity: data.quantity,
    condition: data.condition,
    note: data.note?.trim() || '',
  });
}

export async function updateItemCondition(id: string, condition: ConditionOption) {
  return inventoryRepository.updateItem(id, { condition });
}

export async function removeItem(id: string) {
  return inventoryRepository.deleteItem(id);
}
