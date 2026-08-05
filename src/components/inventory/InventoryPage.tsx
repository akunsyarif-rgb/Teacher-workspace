'use client';

import React, { useState, useEffect } from 'react';
import { Package, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ConfirmDeleteModal from '../ui/ConfirmDeleteModal';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import * as inventoryController from '@/lib/controllers/inventoryController';
import { SkeletonCard } from '../ui/Skeleton';

const CONDITION_COLOR: Record<string, string> = {
  Baik: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  'Rusak Ringan': 'text-amber-600 bg-amber-50 border-amber-200',
  'Rusak Berat': 'text-red-600 bg-red-50 border-red-200',
  Hilang: 'text-gray-500 bg-gray-100 border-gray-200',
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
    setLoading(true);
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
      alert(error.message || 'Gagal menyimpan barang.');
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
      {success && (
        <div className="p-4 bg-emerald-50 text-emerald-700 rounded-2xl flex items-center gap-2 text-xs font-medium">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>Barang berhasil ditambahkan!</span>
        </div>
      )}

      <Card className="space-y-4">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Package className="w-4 h-4 text-blue-600" />
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
        <h3 className="text-sm font-bold text-gray-900">Daftar Barang ({items.length})</h3>
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 py-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
            Belum ada barang inventaris untuk kelas ini.
          </p>
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => (
              <div
                key={item.id}
                className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-gray-900">
                    {item.name} <span className="text-gray-400 font-bold">× {item.quantity}</span>
                  </p>
                  {item.note && <p className="text-[10px] text-gray-500 mt-0.5">{item.note}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={item.condition}
                    onChange={(e) => handleConditionChange(item.id, e.target.value)}
                    className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border outline-none ${
                      CONDITION_COLOR[item.condition] || 'text-gray-600 bg-white border-gray-200'
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
                    className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
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
