'use client';

import React from 'react';
import Link from 'next/link';
import { CreditCard, ArrowRight } from 'lucide-react';
import Card from '../ui/Card';
import { useWorkspace } from '@/src/context/WorkspaceContext';

const PLAN_LABELS: Record<string, string> = {
  individual_lifetime: 'Gratis',
  individual_onetime: 'Individu — Sekali Bayar',
  individual_monthly: 'Individu — Bulanan',
  school_annual: 'Sekolah — Tahunan',
};

// Cuma tampil untuk owner workspace — billing/pembayaran bukan urusan
// guru anggota biasa.
export default function PlanStatusCard() {
  const { user, workspace } = useWorkspace();

  if (!workspace || !user || workspace.ownerUid !== user.uid) return null;

  const planLabel = PLAN_LABELS[workspace.plan] || workspace.plan;
  const expiresAt = workspace.planExpiresAt
    ? new Date(workspace.planExpiresAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-nb-green-soft text-nb-green flex items-center justify-center">
          <CreditCard className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-nb-ink">Paket Workspace</h2>
          <p className="text-xs text-nb-ink-muted">Kelola paket &amp; pembayaran workspace-mu</p>
        </div>
      </div>

      {/* text-nb-ink-muted eksplisit: tanpa itu label mengikuti warna bawaan body, yang hampir putih di mode gelap (tak terbaca di atas latar abu muda). */}
      <div className="p-3 bg-nb-workspace rounded-xl text-xs text-nb-ink-muted space-y-1">
        <p>
          Paket saat ini: <span className="font-bold text-nb-ink">{planLabel}</span>
        </p>
        <p>
          Batas kelas: <span className="font-bold text-nb-ink">{workspace.classLimit ?? 'Tak terbatas'}</span>
        </p>
        {workspace.seatLimit !== undefined && workspace.seatLimit !== null && (
          <p>
            Kuota guru: <span className="font-bold text-nb-ink">{workspace.seatLimit}</span>
          </p>
        )}
        {expiresAt && (
          <p>
            Berlaku sampai: <span className="font-bold text-nb-ink">{expiresAt}</span>
          </p>
        )}
      </div>

      <Link
        href="/upgrade"
        className="flex items-center justify-center gap-2 w-full py-3 bg-nb-green hover:bg-nb-green-strong text-white rounded-2xl text-xs font-bold transition-all"
      >
        <span>Lihat/Upgrade Paket</span>
        <ArrowRight className="w-4 h-4" />
      </Link>
    </Card>
  );
}
