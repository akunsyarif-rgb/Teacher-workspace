'use client';

import React, { useState, useEffect } from 'react';
import { Wallet, Plus, ArrowUpCircle, ArrowDownCircle, Trash2, CheckCircle2 } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ConfirmDeleteModal from '../ui/ConfirmDeleteModal';
import InlineAlert from '../ui/InlineAlert';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import * as classFundController from '@/lib/controllers/classFundController';
import { getCached } from '@/lib/utils/sessionCache';
import { SkeletonCard } from '../ui/Skeleton';

function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value);
}

export default function ClassFundPage() {
  const { workspaceId, teacherProfile } = useWorkspace();
  const className = teacherProfile?.homeroomClassName || '';

  const [transactions, setTransactions] = useState<any[]>([]);
  const [balance, setBalance] = useState(0);
  const [type, setType] = useState<'masuk' | 'keluar'>('masuk');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; description: string } | null>(null);

  useEffect(() => {
    if (workspaceId && className) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [workspaceId, className]);

  async function loadData() {
    if (!workspaceId || !className) return;
    const alreadyWarm = getCached(classFundController.classFundCacheKey(workspaceId, className)) !== undefined;
    if (!alreadyWarm) {
      setLoading(true);
    }
    try {
      const data = await classFundController.fetchClassFundData(workspaceId, className);
      setTransactions(data.transactions);
      setBalance(data.balance);
    } catch (error) {
      console.error('Gagal memuat data kas kelas:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId || !className) return;
    setSubmitting(true);
    setSuccess(false);
    setErrorMsg('');
    try {
      await classFundController.submitClassFundTransaction(workspaceId, className, {
        type,
        amount: parseInt(amount, 10),
        description,
      });
      setAmount('');
      setDescription('');
      setSuccess(true);
      await loadData();
    } catch (error: any) {
      setErrorMsg(error.message || 'Gagal menyimpan transaksi.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await classFundController.deleteClassFundTransaction(deleteTarget.id);
    await loadData();
    setDeleteTarget(null);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-blue-600 p-5 md:p-6 rounded-2xl md:rounded-3xl shadow-lg text-white space-y-1">
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-blue-100">
          Saldo Kas Kelas {className}
        </p>
        <p className="text-3xl font-extrabold">{formatRupiah(balance)}</p>
      </div>

      <InlineAlert message={errorMsg} onDismiss={() => setErrorMsg('')} />

      {success && (
        <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl flex items-center gap-2 text-xs font-medium">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>Transaksi berhasil disimpan!</span>
        </div>
      )}

      <Card className="space-y-4">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-blue-600" />
          Tambah Transaksi
        </h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType('masuk')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                type === 'masuk' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              <ArrowUpCircle className="w-4 h-4" />
              Pemasukan
            </button>
            <button
              type="button"
              onClick={() => setType('keluar')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                type === 'keluar' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              <ArrowDownCircle className="w-4 h-4" />
              Pengeluaran
            </button>
          </div>
          <Input
            label="Jumlah (Rp)"
            type="number"
            value={amount}
            onChange={setAmount}
            placeholder="Contoh: 5000"
            required
          />
          <Input
            label="Keterangan"
            value={description}
            onChange={setDescription}
            placeholder="Contoh: Kas mingguan / Beli spidol"
            required
          />
          <Button type="submit" loading={submitting}>
            <Plus className="w-4 h-4" />
            <span>{submitting ? 'Menyimpan...' : 'Simpan Transaksi'}</span>
          </Button>
        </form>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-bold text-gray-900">Riwayat Transaksi ({transactions.length})</h3>
        {transactions.length === 0 ? (
          <p className="text-xs text-gray-400 py-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
            Belum ada transaksi kas untuk kelas ini.
          </p>
        ) : (
          <div className="space-y-2.5">
            {transactions.map((t) => (
              <div
                key={t.id}
                className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {t.type === 'masuk' ? (
                    <ArrowUpCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                  ) : (
                    <ArrowDownCircle className="w-5 h-5 text-red-600 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-gray-900 truncate">{t.description}</p>
                    <p className="text-[10px] text-gray-500">{t.date}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-xs font-extrabold ${t.type === 'masuk' ? 'text-emerald-600' : 'text-red-600'}`}
                  >
                    {t.type === 'masuk' ? '+' : '-'}
                    {formatRupiah(t.amount)}
                  </span>
                  <button
                    onClick={() => setDeleteTarget({ id: t.id, description: t.description })}
                    className="p-3.5 text-red-500 hover:bg-red-50 rounded-xl transition-colors active:scale-90"
                    title="Hapus Transaksi"
                    aria-label="Hapus Transaksi"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDeleteModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Hapus Transaksi Kas?"
        itemName={deleteTarget?.description || ''}
        itemDetail={`Kelas ${className}`}
        requireTyping={false}
        type="danger"
      />
    </div>
  );
}
