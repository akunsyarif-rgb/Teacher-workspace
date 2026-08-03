import * as classFundRepository from '../repositories/classFundRepository';

export type ClassFundTransactionType = 'masuk' | 'keluar';

export async function loadClassFundData(workspaceId: string, className: string) {
  if (!workspaceId || !className) return { transactions: [] as any[], balance: 0 };

  const transactions = (await classFundRepository.getTransactions(workspaceId, className)).sort(
    (a: any, b: any) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
  );

  const balance = transactions.reduce(
    (sum: number, t: any) => sum + (t.type === 'masuk' ? t.amount : -t.amount),
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
    date: new Date().toISOString().split('T')[0],
  });
}

export async function removeTransaction(id: string) {
  return classFundRepository.deleteTransaction(id);
}
