import { z } from 'zod';
import { CLASS_NAME_MAX_LENGTH } from '../utils/classNameValidation';
import { MAX_FILE_BYTES } from '../utils/uploadRules';

// Skema payload request untuk route /api. Satu sumber untuk (1) validasi di server dan
// (2) tipe TypeScript (z.infer) yang dipakai kode di sekitarnya — menggantikan `any`
// dan pengecekan `typeof` yang tersebar. Pesan dalam bahasa Indonesia karena sampai ke pengguna.
//
// Aturan penting: skema hanya memeriksa BENTUK dan batas wajar. Aturan bisnis (kuota paket,
// kepemilikan, kode benar/salah) tetap di service — jangan memindahkannya ke sini.

const trimmed = (message: string, max: number) =>
  z.string({ error: message }).trim().min(1, message).max(max, message);

const className = trimmed(`Nama kelas wajib diisi (maks ${CLASS_NAME_MAX_LENGTH} karakter).`, CLASS_NAME_MAX_LENGTH);

export const NewStudentSchema = z.object({
  name: trimmed('Nama siswa wajib diisi (maks 120 karakter).', 120),
  nis: z
    .string()
    .trim()
    .max(40, 'NIS maksimal 40 karakter.')
    .optional()
    .transform((v) => v || '-'),
  className: className.transform((v) => v.replace(/\s+/g, ' ').toUpperCase()),
});
export type NewStudent = z.infer<typeof NewStudentSchema>;

export const CreateStudentsBodySchema = z.object({
  students: z
    .array(NewStudentSchema, { error: 'Data siswa wajib diisi.' })
    .min(1, 'Data siswa wajib diisi.')
    .max(200, 'Maksimal 200 siswa per permintaan.'),
});
export type CreateStudentsBody = z.infer<typeof CreateStudentsBodySchema>;

export const RenameClassBodySchema = z.object({
  oldName: z.string({ error: 'Nama kelas lama dan baru diperlukan.' }).min(1, 'Nama kelas lama dan baru diperlukan.'),
  newName: z.string({ error: 'Nama kelas lama dan baru diperlukan.' }).min(1, 'Nama kelas lama dan baru diperlukan.'),
});
export type RenameClassBody = z.infer<typeof RenameClassBodySchema>;

export const ClassNameBodySchema = z.object({
  className: z.string({ error: 'Kelas tidak valid.' }).trim().min(1, 'Kelas tidak valid.').max(CLASS_NAME_MAX_LENGTH, 'Kelas tidak valid.'),
});
export type ClassNameBody = z.infer<typeof ClassNameBodySchema>;

export const StudentIdBodySchema = z.object({
  studentId: z.string({ error: 'Siswa tidak valid.' }).trim().min(1, 'Siswa tidak valid.').max(200, 'Siswa tidak valid.'),
});
export type StudentIdBody = z.infer<typeof StudentIdBodySchema>;

export const JoinWorkspaceBodySchema = z.object({
  inviteCode: z.string({ error: 'Kode undangan diperlukan.' }).trim().min(1, 'Kode undangan diperlukan.').max(64, 'Kode undangan diperlukan.'),
});
export type JoinWorkspaceBody = z.infer<typeof JoinWorkspaceBodySchema>;

export const PAID_PLANS = ['individual_onetime', 'individual_monthly', 'school_annual'] as const;
export const CreateTransactionBodySchema = z.object({
  workspaceId: z.string({ error: 'workspaceId dan plan yang valid diperlukan.' }).min(1, 'workspaceId dan plan yang valid diperlukan.').max(200),
  plan: z.enum(PAID_PLANS, { error: 'workspaceId dan plan yang valid diperlukan.' }),
  // Bentuk saja; rentang valid (1..500) dan pesannya ditegakkan service.
  seatCount: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.coerce.number().optional()),
});
export type CreateTransactionBody = z.infer<typeof CreateTransactionBodySchema>;

export const UploadSignBodySchema = z.object({
  workspaceId: z.string().min(1).max(200),
  assignmentId: z.string().min(1).max(200),
  fileName: z.string().min(1).max(1000),
  // contentType divalidasi ketat oleh validateUploadRequest (allowlist); di sini cukup string.
  contentType: z.string().max(200),
  fileSize: z.number().int().positive().max(MAX_FILE_BYTES * 10),
});
export type UploadSignBody = z.infer<typeof UploadSignBodySchema>;

export const SignDownloadBodySchema = z.object({
  filePath: z.string().min(1).max(1000),
});
export type SignDownloadBody = z.infer<typeof SignDownloadBodySchema>;
