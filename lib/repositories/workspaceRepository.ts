import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  limit,
} from 'firebase/firestore';
import { db } from '@/src/config/firebase';

const WORKSPACES_COLLECTION = 'workspaces';

export type WorkspacePlan = 'individual_lifetime' | 'individual_monthly' | 'school_annual';

export type WorkspaceDoc = {
  name: string;
  plan: WorkspacePlan;
  ownerUid: string;
  classLimit: number | null; // null = tak terbatas
  inviteCode?: string;
  inviteCodeExpiresAt?: number; // epoch ms
  createdAt?: any;
  updatedAt?: any;
};

export async function createWorkspaceDoc(data: WorkspaceDoc) {
  const newDocRef = doc(collection(db, WORKSPACES_COLLECTION));
  await setDoc(newDocRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return newDocRef.id;
}

export async function getWorkspaceById(workspaceId: string) {
  const snap = await getDoc(doc(db, WORKSPACES_COLLECTION, workspaceId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as WorkspaceDoc & { id: string }) : null;
}

export async function findWorkspaceByInviteCode(inviteCode: string) {
  const q = query(
    collection(db, WORKSPACES_COLLECTION),
    where('inviteCode', '==', inviteCode),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as WorkspaceDoc & { id: string };
}

export async function updateWorkspaceInviteCode(
  workspaceId: string,
  inviteCode: string,
  inviteCodeExpiresAt: number
) {
  await updateDoc(doc(db, WORKSPACES_COLLECTION, workspaceId), {
    inviteCode,
    inviteCodeExpiresAt,
    updatedAt: serverTimestamp(),
  });
}
