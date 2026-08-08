'use client';

import React, { useState } from 'react';
import Script from 'next/script';
import { CheckCircle2, User, GraduationCap, Building2 } from 'lucide-react';
import Card from '@/src/components/ui/Card';
import Button from '@/src/components/ui/Button';
import WorkspaceGuard from '@/src/components/ui/WorkspaceGuard';
import { useWorkspace } from '@/src/context/WorkspaceContext';

const SNAP_SRC =
  process.env.NEXT_PUBLIC_MIDTRANS_IS_PRODUCTION === 'true'
    ? 'https://app.midtrans.com/snap/snap.js'
    : 'https://app.sandbox.midtrans.com/snap/snap.js';

declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        options?: {
          onSuccess?: (result: unknown) => void;
          onPending?: (result: unknown) => void;
          onError?: (result: unknown) => void;
          onClose?: () => void;
        }
      ) => void;
    };
  }
}

type PaidPlanKey = 'individual_onetime' | 'individual_monthly' | 'school_annual';

const PLAN_INFO: Record<PaidPlanKey, { title: string; price: string; desc: string; icon: typeof User }> = {
  individual_onetime: {
    title: 'Individu — Sekali Bayar',
    price: 'Rp149.000',
    desc: '6 kelas, berlaku selamanya, tanpa langganan',
    icon: User,
  },
  individual_monthly: {
    title: 'Individu — Bulanan',
    price: 'Rp19.000 / bulan',
    desc: 'Kelas tak terbatas + akses fitur baru saat rilis',
    icon: GraduationCap,
  },
  school_annual: {
    title: 'Sekolah — Tahunan',
    price: 'Rp20.000 / guru / bulan',
    desc: 'Ditagih sekali di muka untuk 1 tahun, kelas tak terbatas',
    icon: Building2,
  },
};

const PLAN_ORDER: PaidPlanKey[] = ['individual_onetime', 'individual_monthly', 'school_annual'];
const SCHOOL_ANNUAL_PRICE_PER_SEAT = 240_000;

function UpgradeContent() {
  const { user, workspace, workspaceId } = useWorkspace();
  const [scriptReady, setScriptReady] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<PaidPlanKey | null>(null);
  const [error, setError] = useState('');
  const [seatCount, setSeatCount] = useState(5);

  const isOwner = !!user && !!workspace && workspace.ownerUid === user.uid;

  async function handlePay(plan: PaidPlanKey) {
    if (!user || !workspaceId) return;
    setError('');
    setLoadingPlan(plan);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/payments/create-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          workspaceId,
          plan,
          seatCount: plan === 'school_annual' ? seatCount : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuat transaksi pembayaran.');

      if (!window.snap) {
        throw new Error('Modul pembayaran belum siap dimuat. Coba lagi sesaat lagi.');
      }
      window.snap.pay(data.token, {
        onSuccess: () => window.location.reload(),
        onPending: () => window.location.reload(),
        onError: () => setError('Pembayaran gagal diproses. Silakan coba lagi.'),
        onClose: () => setLoadingPlan(null),
      });
    } catch (err: any) {
      setError(err.message || 'Gagal memulai pembayaran.');
      setLoadingPlan(null);
    }
  }

  if (!isOwner) {
    return (
      <Card>
        <p className="text-xs text-gray-500">
          Hanya pemilik workspace yang bisa mengelola paket &amp; pembayaran. Hubungi admin/pemilik workspace-mu kalau
          workspace perlu di-upgrade.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Script src={SNAP_SRC} data-client-key={process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY} onReady={() => setScriptReady(true)} />

      <div>
        <h1 className="text-xl font-extrabold text-gray-900">Upgrade Paket</h1>
        <p className="text-xs text-gray-500 mt-1">
          Paket saat ini: <span className="font-bold">{workspace?.plan}</span> · Batas kelas:{' '}
          <span className="font-bold">{workspace?.classLimit ?? 'Tak terbatas'}</span>
        </p>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-xs font-bold">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-3">
        {PLAN_ORDER.map((key) => {
          const info = PLAN_INFO[key];
          const Icon = info.icon;
          return (
            <Card key={key} className="space-y-3 flex flex-col">
              <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-extrabold text-gray-900">{info.title}</h3>
                <p className="text-lg font-extrabold text-blue-600 mt-1">{info.price}</p>
                <p className="text-xs text-gray-500 mt-1">{info.desc}</p>
              </div>

              {key === 'school_annual' && (
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Jumlah Kursi Guru
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={seatCount}
                    onChange={(e) => setSeatCount(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full mt-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Total: Rp{(seatCount * SCHOOL_ANNUAL_PRICE_PER_SEAT).toLocaleString('id-ID')} / tahun
                  </p>
                </div>
              )}

              <Button type="button" onClick={() => handlePay(key)} loading={loadingPlan === key} disabled={!scriptReady}>
                <CheckCircle2 className="w-4 h-4" />
                <span>Bayar Sekarang</span>
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function UpgradePage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-10">
      <div className="max-w-4xl mx-auto">
        <WorkspaceGuard>
          <UpgradeContent />
        </WorkspaceGuard>
      </div>
    </div>
  );
}
