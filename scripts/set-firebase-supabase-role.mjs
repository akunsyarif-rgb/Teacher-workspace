import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
if (!raw) throw new Error('Set FIREBASE_ADMIN_SERVICE_ACCOUNT to the complete Firebase service-account JSON.');
const serviceAccount = JSON.parse(raw);
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });

const auth = getAuth();
let nextPageToken;
let total = 0;
do {
  const page = await auth.listUsers(1000, nextPageToken);
  nextPageToken = page.pageToken;
  await Promise.all(page.users.map(async (user) => {
    const existing = user.customClaims || {};
    await auth.setCustomUserClaims(user.uid, { ...existing, role: 'authenticated' });
    total += 1;
  }));
} while (nextPageToken);

console.log(`Assigned role=authenticated to ${total} Firebase users.`);
console.log('Users must refresh/reissue their ID token before Supabase accepts the authenticated role.');
