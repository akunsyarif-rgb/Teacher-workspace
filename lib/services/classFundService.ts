import * as classFundRepository from '../repositories/classFundRepository';
import { getWitaDateString } from '../utils/witaDate';
import type { Doc } from '../adapters/firestoreAdapter';
import type { ClassFundTransactionData } from '../types/models';

export type ClassFundTransactionType = 'masuk' | 'keluar';

export async function loadClassFundData(workspaceId: string, className: string) {
  if (!workspaceId || !className) return { transactions: [] as Doc<ClassFundTransactionData>[], balance: 0 };

  const transactions = (await classFundRepository.getTransactions(workspaceId, className)).sort(
    (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
  );

  const balance = transactions.reduce(
    (sum: number, t) => sum + (t.type === 'masuk' ? t.amount : -t.amount),
    0
  );

  return { transactions, balance };
}

export async function addTransaction(
  workspaceId: string,
  className: string,
  data: { type: ClassFundTransactionType; amount: number; description: string }
) {
  if (!workspaceId || !className) throw new Error('Kelas tidak valid.');
  if (!data.amount || data.amount <= 0) throw new Error('Jumlah harus lebih dari 0.');
  if (!data.description || !data.description.trim()) throw new Error('Keterangan wajib diisi.');

  return classFundRepository.createTransaction({
    workspaceId,
    className,
    type: data.type,
    amount: data.amount,
    description: data.description.trim(),
    date: getWitaDateString(),
  });
}

export async function removeTransaction(id: string) {
  return classFundRepository.deleteTransaction(id);
}
