// Bentuk dokumen Firestore di batas repository -> service. Menggantikan `any` di
// lapisan data. Field di luar daftar tetap diizinkan (data lama / field lepas),
// tetapi field yang DIPAKAI kode bertipe jelas.
//
// Timestamp Firestore dapat berupa Timestamp, objek {seconds}, string ISO, atau
// null sesaat setelah ditulis (serverTimestamp belum terisi) — maka `unknown`;
// konversinya ada di util masing-masing (mis. toMillis).
export type FirestoreTime = unknown;

export interface TenantFields {
  workspaceId: string;
  /** uid pembuat; immutable. Dokumen lama bisa tidak memilikinya. */
  createdBy?: string;
  createdAt?: FirestoreTime;
  /** Soft delete (lib/utils/softDelete.ts). null/tidak ada = aktif. */
  deletedAt?: FirestoreTime;
  deletedBy?: string | null;
  deletedBatchId?: string | null;
}

export interface StudentData extends TenantFields {
  name: string;
  nis?: string;
  className: string;
  accessCode?: string;
}

export interface AssignmentData extends TenantFields {
  className: string;
  subject?: string;
  title: string;
  description?: string;
  /** YYYY-MM-DD */
  dueDate?: string;
  gradeColumnId?: string;
  materialFileUrl?: string;
  materialFileName?: string;
  materialFilePath?: string;
}

export interface GradeColumnData extends TenantFields {
  className: string;
  title: string;
  type?: string;
}

export interface GradeData {
  workspaceId: string;
  className: string;
  studentId: string;
  columnId: string;
  score: string;
  updatedAt?: FirestoreTime;
}

export interface ScheduleData extends TenantFields {
  /** Nama hari, mis. "Senin". */
  day: string;
  timeSlot: string;
  className: string;
  subject: string;
}

export interface SubmissionAttachmentData {
  fileUrl?: string;
  fileName?: string;
  filePath?: string;
  contentType?: string;
}

export interface SubmissionData {
  workspaceId: string;
  assignmentId: string;
  studentId: string;
  className?: string;
  status?: string;
  textAnswer?: string;
  feedback?: string;
  score?: string | null;
  attachments?: SubmissionAttachmentData[];
  /** String ISO (ditulis klien saat mengumpulkan). */
  submittedAt?: string | null;
  updatedAt?: FirestoreTime;
}

export interface WorkspaceData {
  name: string;
  plan: string;
  ownerUid: string;
  classLimit: number | null;
  seatLimit?: number | null;
  planExpiresAt?: number | null;
}

// Dokumen berbasis kelas/tanggal. Field di luar yang disebut (isi jurnal, catatan, dst.)
// tetap ada di dokumen tetapi belum dimodelkan di sini.
export interface JournalData extends TenantFields {
  className: string;
  /** YYYY-MM-DD */
  date: string;
  scheduleId?: string;
  subject?: string;
  topic?: string;
  notes?: string;
  [extra: string]: unknown;
}

export interface AttendanceDetailData {
  studentId: string;
  status?: string;
  [extra: string]: unknown;
}

export interface AttendanceData extends TenantFields {
  className: string;
  /** YYYY-MM-DD */
  date: string;
  scheduleId?: string;
  details?: AttendanceDetailData[];
  [extra: string]: unknown;
}

export interface SkipReasonData extends TenantFields {
  scheduleId: string;
  date: string;
  reason?: string;
  note?: string;
  [extra: string]: unknown;
}

export interface AnnouncementData extends TenantFields {
  className: string;
  /** YYYY-MM-DD */
  date?: string;
  title?: string;
  [extra: string]: unknown;
}

export interface ClassFundTransactionData extends TenantFields {
  className: string;
  date: string;
  type: 'masuk' | 'keluar';
  amount: number;
  [extra: string]: unknown;
}

export interface StudentNoteData extends TenantFields {
  className: string;
  category?: string;
  date?: string;
  [extra: string]: unknown;
}

export interface AchievementData extends TenantFields {
  className: string;
  studentId?: string;
  date?: string;
  [extra: string]: unknown;
}
