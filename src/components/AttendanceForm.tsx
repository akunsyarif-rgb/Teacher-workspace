'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BookOpen, UserCheck, Table, History, CheckCircle2, Circle, PartyPopper, ClipboardList, Megaphone, Flag } from 'lucide-react';
import Card from './ui/Card';
import ClassSelector from './attendance/ClassSelector';
import JournalTab from './journal/JournalTab';
import AttendanceTab from './attendance/AttendanceTab';
import GradesTab from './grades/GradesTab';
import AssignmentsTab from './assignments/AssignmentsTab';
import AnnouncementsTab from './announcements/AnnouncementsTab';
import TimelineTab from './timeline/TimelineTab';
import UnsavedChangesModal from './UnsavedChangesModal';
import SessionFinishModal from './SessionFinishModal';
import { useWorkspace } from '@/src/context/WorkspaceContext';
import * as classController from '@/lib/controllers/classController';
import * as scheduleController from '@/lib/controllers/scheduleController';
import * as dashboardController from '@/lib/controllers/dashboardController';
import { getCurrentDayName, TodayClassStatus } from '@/lib/services/dashboardService';
import { findActiveScheduleId, resolveCurrentWorkflowStep } from '@/lib/utils/scheduleTime';
import { getCached } from '@/lib/utils/sessionCache';

type WorkspaceTab = 'jurnal' | 'presensi' | 'nilai' | 'tugas' | 'pengumuman' | 'riwayat';
const VALID_TABS: WorkspaceTab[] = ['jurnal', 'presensi', 'nilai', 'tugas', 'pengumuman', 'riwayat'];

export default function AttendanceForm() {
  const { workspaceId } = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('jurnal');
  const [classesList, setClassesList] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [subject, setSubject] = useState('');
  const [schedules, setSchedules] = useState<any[]>([]);
  const [todayClassStatuses, setTodayClassStatuses] = useState<TodayClassStatus[]>([]);
  const [loading, setLoading] = useState(true);

  // true begitu selectedClass sudah ditentukan (dari deep-link ?class= ATAU
  // dari fallback Workflow Engine di bawah) — REF, bukan dicek lewat
  // `!selectedClass` pada closure state seperti sebelumnya. Kenapa: waktu
  // navigasi client-side (klik <Link> dari Beranda) window.location.search
  // belum ter-update di render PERTAMA komponen ini — jadi kalau deep-link
  // dibaca langsung dari window.location (baik lewat lazy initializer
  // useState maupun efek terpisah), nilainya masih kosong saat itu.
  // useSearchParams() akhirnya benar juga, tapi baru di render berikutnya —
  // closure effect fallback di bawah tetap bisa menangkap selectedClass
  // versi lama (kosong) kalau dicek lewat state biasa. Ref dibaca LIVE
  // (`.current`), jadi begitu efek deep-link di bawah sempat commit — kapan
  // pun itu — fallback tidak akan pernah menimpanya lagi. Ini pernah jadi
  // bug nyata: klik "XI F Teknik 2" dari Beranda diam-diam berakhir di
  // kelas lain. JANGAN ganti balik ke window.location manual atau ke cek
  // `!selectedClass` di closure state.
  const classResolvedRef = useRef(false);

  // Sinyal "ada perubahan belum tersimpan" dari Jurnal/Nilai — hanya salah
  // satu yang bisa true di satu waktu karena tab lain unmount saat pindah
  // (lihat render tab di bawah, masing-masing dibungkus `activeTab === ...`).
  const [journalDirty, setJournalDirty] = useState(false);
  const [gradesDraftCount, setGradesDraftCount] = useState(0);
  const journalSaveRef = useRef<(() => Promise<void>) | null>(null);
  const gradesOpenReviewRef = useRef<(() => void) | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const hasUnsavedChanges = journalDirty || gradesDraftCount > 0;

  // Cegah tab/browser ditutup begitu saja saat ada draft Jurnal/Nilai yang
  // belum tersimpan — pelengkap requestLeave() di bawah yang menjaga
  // navigasi DI DALAM aplikasi (ganti tab/kelas/Beranda).
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Titik tunggal semua navigasi "berpindah konteks" (ganti tab, ganti
  // kelas, ke Beranda) harus lewat sini — supaya guard Unsaved Changes
  // tidak bisa terlewat kalau nanti ditambah titik navigasi baru.
  function requestLeave(action: () => void) {
    if (hasUnsavedChanges) {
      setPendingAction(() => action);
      setShowUnsavedModal(true);
    } else {
      action();
    }
  }

  function handleCancelLeave() {
    setShowUnsavedModal(false);
    setPendingAction(null);
  }

  function handleLeaveWithoutSaving() {
    const action = pendingAction;
    setJournalDirty(false);
    setGradesDraftCount(0);
    setShowUnsavedModal(false);
    setPendingAction(null);
    action?.();
  }

  async function handleSaveAndLeave() {
    try {
      if (journalDirty) {
        await journalSaveRef.current?.();
        setJournalDirty(false);
        setShowUnsavedModal(false);
        const action = pendingAction;
        setPendingAction(null);
        action?.();
      } else if (gradesDraftCount > 0) {
        // Nilai "Proteksi Tinggi": tidak langsung tersimpan lewat sini —
        // cukup buka modal Review yang sudah ada (tutup dialog Unsaved
        // Changes-nya sendiri supaya tidak dua modal bertumpuk), guru tetap
        // harus menekan konfirmasi eksplisit di sana. `pendingAction`
        // SENGAJA dibiarkan tersimpan (bukan dihapus) — begitu guru
        // benar-benar konfirmasi di GradesReviewModal, handleGradesSaved
        // di bawah yang melanjutkan navigasinya, supaya tombol "Simpan &
        // Keluar" jujur: benar-benar berakhir keluar, bukan cuma membuka
        // Review lalu diam di situ.
        gradesOpenReviewRef.current?.();
        setShowUnsavedModal(false);
      }
    } catch {
      // JournalTab sudah menampilkan errorMsg-nya sendiri; biarkan dialog
      // tetap terbuka supaya guru bisa coba lagi atau batal.
    }
  }

  // Dipanggil GradesTab setelah nilai BENAR-BENAR tersimpan (guru menekan
  // konfirmasi di GradesReviewModal) — melanjutkan navigasi yang tertunda
  // KALAU ada (dari alur "Simpan & Keluar"). Kalau guru menyimpan nilai
  // lewat tombol "Review & Simpan" biasa (bukan lewat guard), pendingAction
  // memang null di sini dan fungsi ini jadi no-op — aman dipanggil selalu.
  function handleGradesSaved() {
    setGradesDraftCount(0);
    const action = pendingAction;
    setPendingAction(null);
    action?.();
  }

  // Dukung deep-link dari Action Center Beranda (?class=XI+A&tab=presensi)
  // — pakai useSearchParams() (reaktif terhadap navigasi App Router),
  // BUKAN window.location.search manual.
  useEffect(() => {
    const cls = searchParams.get('class');
    const tab = searchParams.get('tab');
    if (cls) {
      setSelectedClass(cls);
      classResolvedRef.current = true;
    }
    if ((VALID_TABS as string[]).includes(tab || '')) {
      setActiveTab(tab as WorkspaceTab);
    }
  }, [searchParams]);

  // Sesi yang ditunjuk eksplisit oleh deep-link (?scheduleId=...). Dipakai
  // saat guru membuka satu sesi TERTENTU dari Beranda — mis. sesi yang jam
  // pelajarannya sudah lewat di daftar Perlu Konfirmasi. Tanpa ini,
  // findActiveScheduleId jatuh ke slot pertama hari itu, jadi kelas yang
  // punya dua slot di hari yang sama bisa membuka slot yang keliru.
  const requestedScheduleId = searchParams.get('scheduleId');

  useEffect(() => {
    const savedSubject = localStorage.getItem('teacher_main_subject');
    setSubject(savedSubject || '');
  }, []);

  // Jaga URL selalu sinkron dengan kelas yang sedang ditampilkan — baik
  // saat dipilih otomatis (fallback Workflow Engine di bawah) maupun saat
  // guru ganti kelas lewat ClassSelector. Ini yang membuat "kelas yang
  // baru saja dipilih" bertahan kalau halaman di-refresh/dibagikan, DAN
  // yang membuat regresi seperti di atas langsung kelihatan lewat address
  // bar (bukan cuma di state React yang tidak terlihat).
  useEffect(() => {
    if (!selectedClass || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('class') === selectedClass) return;
    params.set('class', selectedClass);
    router.replace(`/attendance?${params.toString()}`, { scroll: false });
  }, [selectedClass, router]);

  // Muat kelas, jadwal, dan status sesi bersamaan — Workflow Engine perlu
  // ketiganya sekaligus untuk memilihkan kelas default yang paling relevan
  // (sesi yang sedang berlangsung), bukan sekadar kelas pertama di daftar.
  useEffect(() => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    (async () => {
      // Data ini sudah di-cache (withCache), tapi tanpa cek ini
      // setLoading(true) selalu menyalakan spinner besar "Memuat data
      // kelas..." setiap kali guru keluar-masuk /attendance lewat tab
      // Kelas Aktif — walau ketiga sumbernya sudah hangat, tidak ada
      // permintaan Firestore baru yang sebenarnya terjadi.
      const alreadyWarm =
        getCached(classController.classSummariesCacheKey(workspaceId)) !== undefined &&
        getCached(scheduleController.schedulesCacheKey(workspaceId)) !== undefined &&
        getCached(
          dashboardController.dashboardSummaryCacheKey(workspaceId),
          dashboardController.DASHBOARD_SUMMARY_TTL_MS
        ) !== undefined;

      if (!alreadyWarm) {
        setLoading(true);
      }
      const [summaries, scheduleList, statuses] = await Promise.all([
        classController.fetchClassSummaries(workspaceId).catch((error) => {
          console.error('Gagal memuat daftar kelas:', error);
          return [];
        }),
        scheduleController.fetchSchedules(workspaceId).catch((error) => {
          console.error('Gagal memuat jadwal:', error);
          return [];
        }),
        loadSessionStatuses(),
      ]);
      const classNames = summaries.map((s: any) => s.className);
      setClassesList(classNames);
      setSchedules(scheduleList);
      if (classNames.length > 0 && !classResolvedRef.current) {
        classResolvedRef.current = true;
        const step = resolveCurrentWorkflowStep(statuses);
        setSelectedClass(step && classNames.includes(step.status.className) ? step.status.className : classNames[0]);
      }
      setLoading(false);
    })();
  }, [workspaceId]);

  async function loadSessionStatuses() {
    if (!workspaceId) return [];
    try {
      const summary = await dashboardController.fetchDashboardSummary(workspaceId);
      const statuses = summary.todayClassStatuses || [];
      setTodayClassStatuses(statuses);
      return statuses;
    } catch (error) {
      console.error('Gagal memuat status sesi mengajar:', error);
      return [];
    }
  }

  // scheduleId dari deep-link menang, TAPI hanya kalau sesi itu memang milik
  // kelas yang sedang dibuka & terdaftar hari ini — kalau tidak (link basi,
  // jadwal sudah dihapus, ganti kelas lewat dropdown), jatuh ke penentuan
  // otomatis seperti sebelumnya.
  const requestedSession =
    requestedScheduleId && selectedClass
      ? todayClassStatuses.find(
          (s) => s.scheduleId === requestedScheduleId && s.className === selectedClass
        )
      : undefined;

  const activeScheduleId = selectedClass
    ? requestedSession?.scheduleId ?? findActiveScheduleId(schedules, selectedClass, getCurrentDayName())
    : null;

  const currentSession = todayClassStatuses.find((s) => s.scheduleId === activeScheduleId) ?? null;

  // Setelah presensi/jurnal tersimpan, refresh status sesi dan otomatis
  // pindah ke langkah berikutnya kalau sesi ini punya jadwal hari ini —
  // supaya guru tidak perlu klik-klik menu sendiri (lihat diskusi
  // "Class Workspace" & "Workflow Engine" di roadmap).
  async function handleAttendanceSubmitted() {
    const statuses = await loadSessionStatuses();
    const updated = statuses.find((s) => s.scheduleId === activeScheduleId);
    if (updated && !updated.hasJournal) {
      setActiveTab('jurnal');
    }
  }

  async function handleJournalSubmitted() {
    await loadSessionStatuses();
  }

  const tabs = [
    { key: 'jurnal', label: 'Jurnal Mengajar', icon: BookOpen },
    { key: 'presensi', label: 'Presensi', icon: UserCheck },
    { key: 'nilai', label: 'Nilai', icon: Table },
    { key: 'tugas', label: 'Tugas', icon: ClipboardList },
    { key: 'pengumuman', label: 'Pengumuman', icon: Megaphone },
    { key: 'riwayat', label: 'Riwayat', icon: History },
  ] as const;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <span className="ml-3 text-xs font-bold text-gray-500">Memuat data kelas...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">
            {selectedClass ? `Kelas ${selectedClass}` : 'Pusat Kegiatan Kelas & Penilaian'}
          </h2>
          <p className="text-xs text-gray-500">Kelola jurnal, presensi, nilai, dan riwayat dalam satu layar</p>
        </div>

        {/* Baris tab di-scroll horizontal (bukan disempitkan/disingkat)
            supaya label tetap terbaca penuh walau ada 6 tab di layar HP. */}
        <div className="flex gap-1.5 bg-gray-100 p-1.5 rounded-2xl overflow-x-auto no-scrollbar">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => {
                if (key === activeTab) return;
                requestLeave(() => setActiveTab(key));
              }}
              title={label}
              className={`shrink-0 flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all active:scale-95 ${
                activeTab === key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="pt-2 border-t border-gray-100">
          {classesList.length === 0 ? (
            <p className="text-xs text-gray-400">Belum ada data kelas atau siswa di database.</p>
          ) : (
            <ClassSelector
              classes={classesList}
              selected={selectedClass}
              onChange={(cls) => {
                if (cls === selectedClass) return;
                requestLeave(() => setSelectedClass(cls));
              }}
            />
          )}
        </div>
      </Card>

      {currentSession && (
        <div
          className={`p-4 md:p-5 rounded-2xl md:rounded-3xl border space-y-3 ${
            currentSession.isDone
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-blue-50 border-blue-200'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">Sesi Mengajar</p>
              <p className="text-sm font-extrabold text-gray-900">
                Kelas {currentSession.className} • {currentSession.timeSlot}
                {currentSession.subject ? ` • ${currentSession.subject}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`flex items-center gap-1.5 text-xs font-bold ${currentSession.hasAttendance ? 'text-emerald-700' : 'text-gray-400'}`}>
                {currentSession.hasAttendance ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                Presensi
              </span>
              <span className={`flex items-center gap-1.5 text-xs font-bold ${currentSession.hasJournal ? 'text-emerald-700' : 'text-gray-400'}`}>
                {currentSession.hasJournal ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                Jurnal
              </span>
              <button
                type="button"
                onClick={() => setShowFinishModal(true)}
                className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-900 transition-colors"
              >
                <Flag className="w-4 h-4" />
                Selesai Mengajar
              </button>
            </div>
          </div>

          {currentSession.isDone && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-emerald-200">
              <p className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                <PartyPopper className="w-4 h-4" />
                Sesi ini sudah selesai — kerja bagus!
              </p>
              <button
                type="button"
                onClick={() => requestLeave(() => router.push('/'))}
                className="text-xs font-bold text-blue-600 hover:underline"
              >
                Kembali ke Beranda →
              </button>
            </div>
          )}
        </div>
      )}

      {selectedClass && activeTab === 'jurnal' && (
        <JournalTab
          className={selectedClass}
          subject={subject}
          scheduleId={activeScheduleId}
          onSubmitted={handleJournalSubmitted}
          onDirtyChange={setJournalDirty}
          saveHandleRef={journalSaveRef}
        />
      )}
      {selectedClass && activeTab === 'presensi' && (
        <AttendanceTab
          className={selectedClass}
          subject={subject}
          scheduleId={activeScheduleId}
          onSubmitted={handleAttendanceSubmitted}
        />
      )}
      {selectedClass && activeTab === 'nilai' && (
        <GradesTab
          className={selectedClass}
          onDraftChange={setGradesDraftCount}
          openReviewRef={gradesOpenReviewRef}
          onSavedSuccessfully={handleGradesSaved}
        />
      )}
      {selectedClass && activeTab === 'tugas' && <AssignmentsTab className={selectedClass} subject={subject} />}
      {selectedClass && activeTab === 'pengumuman' && (
        <AnnouncementsTab className={selectedClass} subject={subject} />
      )}
      {selectedClass && activeTab === 'riwayat' && <TimelineTab className={selectedClass} />}

      <UnsavedChangesModal
        isOpen={showUnsavedModal}
        onCancel={handleCancelLeave}
        onLeaveWithoutSaving={handleLeaveWithoutSaving}
        primaryAction={{
          label: 'Simpan & Keluar',
          onClick: handleSaveAndLeave,
        }}
      />

      {currentSession && (
        <SessionFinishModal
          isOpen={showFinishModal}
          onClose={() => setShowFinishModal(false)}
          onGoHome={() => {
            setShowFinishModal(false);
            requestLeave(() => router.push('/'));
          }}
          className={currentSession.className}
          hasAttendance={currentSession.hasAttendance}
          hasJournal={currentSession.hasJournal}
          gradesDraftCount={gradesDraftCount}
        />
      )}
    </div>
  );
}
