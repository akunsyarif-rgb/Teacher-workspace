'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@src/config/firebase';
import { fetchCurrentStudentProfile } from '../../lib/controllers/studentAuthController';

export type StudentProfile = {
  id: string;
  studentId: string;
  workspaceId: string;
  className: string;
  name: string;
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

export function StudentAuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StudentAuthContextValue>(defaultState);

  async function loadForUser(user: User) {
    try {
      const profile = await fetchCurrentStudentProfile(user.uid);
      setState({
        user,
        profile: profile as StudentProfile | null,
        loading: false,
        refreshProfile: () => loadForUser(user),
      });
    } catch (err) {
      console.error('Gagal memuat profil siswa:', err);
      setState((prev) => ({ ...prev, user, loading: false }));
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ user: null, profile: null, loading: false, refreshProfile: async () => {} });
        return;
      }
      await loadForUser(user);
    });

    return () => unsubscribe();
  }, []);

  return <StudentAuthContext.Provider value={state}>{children}</StudentAuthContext.Provider>;
}

export function useStudentAuth() {
  return useContext(StudentAuthContext);
}
