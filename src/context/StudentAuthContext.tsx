'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@src/config/firebase';
import { fetchCurrentStudentProfile } from '../../lib/controllers/studentAuthController';

export type StudentProfile = {
  id: string;
  studentId: string;
  workspaceId: string;
  className: string;
  name: string;
  nis?: string;
};

type StudentAuthContextValue = {
  user: User | null;
  profile: StudentProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
};

const defaultState: StudentAuthContextValue = {
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
};

const StudentAuthContext = createContext<StudentAuthContextValue>(defaultState);

type StudentAuthState = {
  user: User | null;
  profile: StudentProfile | null;
  loading: boolean;
};

export function StudentAuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StudentAuthState>({ user: null, profile: null, loading: true });

  // refreshProfile membaca auth.currentUser sendiri dan identitasnya tidak
  // pernah berubah (useCallback tanpa dependency). Sebelumnya fungsi ini
  // ikut disimpan di dalam state dan bernilai no-op selama belum ada user
  // — halaman login menangkap versi no-op itu di closure-nya, sehingga
  // setelah kode akses ditukar profilnya tidak pernah dimuat ulang dan
  // siswa langsung dilempar balik ke halaman login. Lihat langkah
  // "Beranda siswa menampilkan identitasnya" di tests/e2e/smoke.mjs.
  const refreshProfile = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setState({ user: null, profile: null, loading: false });
      return;
    }
    try {
      const profile = await fetchCurrentStudentProfile(user.uid);
      setState({ user, profile: profile as StudentProfile | null, loading: false });
    } catch (err) {
      console.error('Gagal memuat profil siswa:', err);
      setState((prev) => ({ ...prev, user, loading: false }));
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, () => {
      // Sengaja tidak memakai `user` dari callback: refreshProfile selalu
      // membaca auth.currentUser terbaru, jadi hanya ada satu jalur pemuatan.
      refreshProfile();
    });

    return () => unsubscribe();
  }, [refreshProfile]);

  const value = useMemo(() => ({ ...state, refreshProfile }), [state, refreshProfile]);

  return <StudentAuthContext.Provider value={value}>{children}</StudentAuthContext.Provider>;
}

export function useStudentAuth() {
  return useContext(StudentAuthContext);
}
