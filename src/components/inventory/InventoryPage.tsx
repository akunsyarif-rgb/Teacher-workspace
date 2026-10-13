'use client';

import React, { useState, useEffect } from 'react';
import { Package, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ConfirmDeleteModal from '../ui/ConfirmDeleteModal';
import InlineAlert from '../ui/InlineAlert';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import * as inventoryController from '@/lib/controllers/inventoryController';
import { getCached } from '@/lib/utils/sessionCache';
import { SkeletonCard } from '../ui/Skeleton';

const CONDITION_COLOR: Record<string, string> = {
  Baik: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  'Rusak Ringan': 'text-amber-600 bg-amber-50 border-amber-200',
  'Rusak Berat': 'text-red-600 bg-red-50 border-red-200',
  Hilang: 'text-nb-ink-muted bg-gray-100 border-nb-rule',
};

export default function InventoryPage() {
  const { workspaceId, teacherProfile } = useWorkspace();
  const className = teacherProfile?.homeroomClassName || '';

  const [items, setItems] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (workspaceId && className) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [workspaceId, className]);

  async function loadData() {
    if (!workspaceId || !className) return;
    const alreadyWarm = getCached(inventoryController.inventoryCacheKey(workspaceId, className)) !== undefined;
    if (!alreadyWarm) {
      setLoading(true);
    }
    try {
      const list = await inventoryController.fetchInventoryItems(workspaceId, className);
      setItems(list);
    } catch (error) {
      console.error('Gagal memuat inventaris:', error);
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
      await inventoryController.submitInventoryItem(workspaceId, className, {
        name,
        quantity: parseInt(quantity, 10),
        condition: 'Baik',
        note,
      });
      setName('');
      setQuantity('');
      setNote('');
      setSuccess(true);
      await loadData();
    } catch (error: any) {
      setErrorMsg(error.message || 'Gagal menyimpan barang.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConditionChange(id: string, condition: string) {
    await inventoryController.updateInventoryItemCondition(id, condition);
    await loadData();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await inventoryController.deleteInventoryItem(deleteTarget.id);
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
      <InlineAlert message={errorMsg} onDismiss={() => setErrorMsg('')} />
      {success && (
        <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl flex items-center gap-2 text-xs font-medium">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>Barang berhasil ditambahkan!</span>
        </div>
      )}

      <Card className="space-y-4">
        <h3 className="text-sm font-bold text-nb-ink flex items-center gap-2">
          <Package className="w-4 h-4 text-nb-green" />
          Tambah Barang Inventaris
        </h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input label="Nama Barang" value={name} onChange={setName} placeholder="Contoh: Penghapus Papan Tulis" required />
          <Input label="Jumlah" type="number" value={quantity} onChange={setQuantity} placeholder="Contoh: 2" required />
          <Input label="Catatan (Opsional)" value={note} onChange={setNote} placeholder="Contoh: Disimpan di lemari kelas" />
          <Button type="submit" loading={submitting}>
            <Plus className="w-4 h-4" />
            <span>{submitting ? 'Menyimpan...' : 'Simpan Barang'}</span>
          </Button>
        </form>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-bold text-nb-ink">Daftar Barang ({items.length})</h3>
        {items.length === 0 ? (
          <p className="text-xs text-nb-ink-muted py-8 text-center bg-nb-workspace rounded-2xl border border-dashed border-nb-rule">
            Belum ada barang inventaris untuk kelas ini.
          </p>
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => (
              <div
                key={item.id}
                className="p-4 bg-nb-workspace rounded-2xl border border-nb-rule flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-nb-ink">
                    {item.name} <span className="text-nb-ink-muted font-bold">× {item.quantity}</span>
                  </p>
                  {item.note && <p className="text-xs text-nb-ink-muted mt-0.5">{item.note}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={item.condition}
                    onChange={(e) => handleConditionChange(item.id, e.target.value)}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border outline-none ${
                      CONDITION_COLOR[item.condition] || 'text-nb-ink-muted bg-nb-paper border-nb-rule'
                    }`}
                  >
                    {inventoryController.CONDITION_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setDeleteTarget({ id: item.id, name: item.name })}
                    className="p-3.5 text-red-500 hover:bg-red-50 rounded-xl transition-colors active:scale-90"
                    title="Hapus Barang"
                    aria-label="Hapus Barang"
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
        title="Hapus Barang Inventaris?"
        itemName={deleteTarget?.name || ''}
        itemDetail={`Kelas ${className}`}
        requireTyping={false}
        type="danger"
      />
    </div>
  );
}
