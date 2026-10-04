// Compatibility facade kept under the historical filename so the existing
// repository/service layer does not need a risky mass rename in one step.
// The implementation is now Supabase REST/PostgREST, not Firebase Firestore.
export * from './supabaseAdapter';
