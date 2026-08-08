'use client';

import React, { useEffect, useState } from 'react';
import { Megaphone, Plus, Trash2 } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import { SkeletonCard } from '../ui/Skeleton';
import * as announcementController from '@/lib/controllers/announcementController';
import { useWorkspace } from '@/src/context/WorkspaceContext';

type AnnouncementsTabProps = {
  className: string;
  subject: string;
};

export default function AnnouncementsTab({ className, subject }: AnnouncementsTabProps) {
  const { workspaceId } = useWorkspace();
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (className && workspaceId) loadAnnouncements();
  }, [className, workspaceId]);

  async function loadAnnouncements() {
    if (!workspaceId || !className) return;
    setLoading(true);
    try {
      const list = await announcementController.fetchAnnouncements(workspaceId, className);
      setAnnouncements(list);
    } catch (error) {
      console.error('Gagal memuat pengumuman:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setSaving(true);
    try {
      await announcementController.createAnnouncement(workspaceId, className, subject, { title, body });
      setTitle('');
      setBody('');
      setShowModal(false);
      await loadAnnouncements();
    } catch (error: any) {
      alert(error.message || 'Gagal membuat pengumuman.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Hapus pengumuman ini? Siswa tidak akan melihatnya lagi.')) return;
    await announcementController.removeAnnouncement(id);
    await loadAnnouncements();
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-blue-600" />
            Pengumuman Kelas {className}
          </h3>
          <p className="text-xs text-gray-500">Langsung tampil di aplikasi siswa, tanpa lewat WhatsApp</p>
        </div>
        <Button className="w-auto px-4" onClick={() => setShowModal(true)}>
          <Plus className="w-4 h-4" />
          <span>Buat Pengumuman</span>
        </Button>
      </Card>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Buat Pengumuman Baru">
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            label="Judul"
            value={title}
            onChange={setTitle}
            placeholder="Contoh: Ulangan Bab 3 hari Senin"
            required
          />
          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Isi Pengumuman</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              required
              placeholder="Tulis pengumuman untuk siswa"
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>
              Batal
            </Button>
            <Button type="submit" loading={saving}>
              {saving ? 'Mengirim...' : 'Kirim ke Siswa'}
            </Button>
          </div>
        </form>
      </Modal>

      {loading ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : announcements.length === 0 ? (
        <Card>
          <p className="text-xs text-gray-400 text-center py-4">
            Belum ada pengumuman untuk kelas ini.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {announcements.map((announcement) => (
            <div key={announcement.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-900">{announcement.title}</p>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-0.5">
                    {announcement.date}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(announcement.id)}
                  className="p-2 rounded-xl text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                  title="Hapus pengumuman"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-gray-600 mt-2 whitespace-pre-wrap">{announcement.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
