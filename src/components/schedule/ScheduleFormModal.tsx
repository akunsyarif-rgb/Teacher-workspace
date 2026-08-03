'use client';

import React, { useState } from 'react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { ScheduleInput } from '@/lib/services/scheduleService';

type ScheduleFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
  activeDays: string[];
  defaultSubject: string;
  onSubmit: (input: ScheduleInput) => Promise<void>;
};

export default function ScheduleFormModal({
  isOpen,
  onClose,
  activeDays,
  defaultSubject,
  onSubmit,
}: ScheduleFormModalProps) {
  const [day, setDay] = useState(activeDays[0] ?? 'Senin');
  const [timeSlot, setTimeSlot] = useState('');
  const [className, setClassName] = useState('');
  const [subject, setSubject] = useState(defaultSubject);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onSubmit({ day, timeSlot, className, subject });
      setClassName('');
      setTimeSlot('');
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Gagal menambah jadwal.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Tambah Slot Jadwal Mengajar">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1">Hari</label>
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:ring-2 focus:ring-blue-600"
          >
            {activeDays.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <Input
          label="Jam Pelajaran / Waktu"
          value={timeSlot}
          onChange={setTimeSlot}
          placeholder="Contoh: Jam Ke-1 s.d. 3 / 08.00 - 10.00"
          required
        />

        <Input
          label="Nama Kelas"
          value={className}
          onChange={setClassName}
          placeholder="Contoh: XI F TEKNIK 2"
          required
        />

        <Input label="Mata Pelajaran" value={subject} onChange={setSubject} required />

        {error && <p className="text-[11px] text-red-500 font-semibold">{error}</p>}

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" loading={loading}>
            {loading ? 'Menyimpan...' : 'Simpan Jadwal'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
