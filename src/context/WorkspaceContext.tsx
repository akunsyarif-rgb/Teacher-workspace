'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@src/config/firebase';
import { getTeacherProfile, TeacherProfile, TeacherRole } from '../../lib/repositories/teacherProfileRepository';
import { getWorkspaceById, WorkspaceDoc, WorkspacePlan } from '../../lib/repositories/workspaceRepository';

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

  async function loadForUser(user: User) {
    try {
      const profile = await getTeacherProfile(user.uid);

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

      const workspace = await getWorkspaceById(profile.workspaceId);
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
      setState((prev) => ({ ...prev, user, loading: false }));
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
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

      await loadForUser(user);
    });

    return () => unsubscribe();
  }, []);

  return <WorkspaceContext.Provider value={state}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
