'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@src/config/firebase';
import { getCachedTeacherProfile, getTeacherProfile, TeacherProfile, TeacherRole } from '../../lib/repositories/teacherProfileRepository';
import { getCachedWorkspaceById, getWorkspaceById, WorkspaceDoc, WorkspacePlan } from '../../lib/repositories/workspaceRepository';
import { markSinceNavigation, measure } from '../../lib/utils/perf';

type WorkspaceWithId = WorkspaceDoc & { id: string };

type WorkspaceContextValue = {
  user: User | null;
  workspaceId: string | null;
  workspace: WorkspaceWithId | null;
  role: TeacherRole | null;
  plan: WorkspacePlan | null;
  classLimit: number | null;
  teacherProfile: TeacherProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
};

const defaultState: WorkspaceContextValue = {
  user: null,
  workspaceId: null,
  workspace: null,
  role: null,
  plan: null,
  classLimit: null,
  teacherProfile: null,
  loading: true,
  refreshProfile: async () => {},
};

const WorkspaceContext = createContext<WorkspaceContextValue>(defaultState);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WorkspaceContextValue>(defaultState);

  async function loadForUser(user: User, useCache = false) {
    // Stale-while-revalidate hanya untuk pembukaan awal: profil + workspace
    // yang sudah ada di cache lokal langsung ditampilkan, lalu diverifikasi
    // ke server di bawah (plan/role yang berubah ikut diperbarui). Akses data
    // tetap diputuskan Security Rules. refreshProfile() sengaja tanpa cache
    // supaya hasilnya selalu terbaru.
    let shownFromCache = false;
    if (useCache) {
      try {
        const cachedProfile = await measure('guru startup: profil dari cache', () => getCachedTeacherProfile(user.uid));
        if (cachedProfile?.workspaceId) {
          const cachedWorkspace = await measure('guru startup: workspace dari cache', () => getCachedWorkspaceById(cachedProfile.workspaceId as string));
          if (cachedWorkspace) {
            shownFromCache = true;
            setState({
              user,
              workspaceId: cachedProfile.workspaceId,
              workspace: cachedWorkspace,
              role: cachedProfile.role ?? null,
              plan: cachedWorkspace.plan ?? null,
              classLimit: cachedWorkspace.classLimit ?? null,
              teacherProfile: cachedProfile,
              loading: false,
              refreshProfile: () => loadForUser(user),
            });
            markSinceNavigation('guru startup: tampil dari cache (sejak halaman dibuka)');
          }
        }
      } catch {
        // cache gagal dibaca = lanjut ke server
      }
    }
    try {
      const profile = await measure('guru startup: baca profil guru (Firestore)', () => getTeacherProfile(user.uid));

      if (!profile?.workspaceId) {
        setState({
          user,
          workspaceId: null,
          workspace: null,
          role: profile?.role ?? null,
          plan: null,
          classLimit: null,
          teacherProfile: profile,
          loading: false,
          refreshProfile: () => loadForUser(user),
        });
        return;
      }

      const workspace = await measure('guru startup: baca workspace (Firestore)', () => getWorkspaceById(profile.workspaceId as string));
      markSinceNavigation('guru startup: data server siap (sejak halaman dibuka)');
      setState({
        user,
        workspaceId: profile.workspaceId,
        workspace,
        role: profile.role ?? null,
        plan: workspace?.plan ?? null,
        classLimit: workspace?.classLimit ?? null,
        teacherProfile: profile,
        loading: false,
        refreshProfile: () => loadForUser(user),
      });
    } catch (err) {
      console.error('Gagal memuat sesi workspace:', err);
      // Server gagal tapi cache sudah tampil: jangan dikosongkan.
      if (!shownFromCache) setState((prev) => ({ ...prev, user, loading: false }));
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      markSinceNavigation('guru startup: Firebase Auth siap (sejak halaman dibuka)');
      if (!user) {
        setState({
          user: null,
          workspaceId: null,
          workspace: null,
          role: null,
          plan: null,
          classLimit: null,
          teacherProfile: null,
          loading: false,
          refreshProfile: async () => {},
        });
        return;
      }

      await loadForUser(user, true);
    });

    return () => unsubscribe();
  }, []);

  return <WorkspaceContext.Provider value={state}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
