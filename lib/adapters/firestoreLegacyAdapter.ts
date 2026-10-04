import { db } from '@/src/config/firebase';
import { collection, doc, getDoc, getDocs, getCountFromServer, addDoc, setDoc, updateDoc, deleteDoc, query, where, writeBatch, serverTimestamp, QueryConstraint } from 'firebase/firestore';
export { serverTimestamp };
function buildQuery(collectionName:string,filters:[string,any,any][]) { const constraints:QueryConstraint[]=filters.map(([field,op,value])=>where(field,op,value)); return constraints.length ? query(collection(db,collectionName),...constraints) : collection(db,collectionName); }
export async function getDocuments(collectionName:string,filters:[string,any,any]=[]) { const snapshot=await getDocs(buildQuery(collectionName,filters)); return snapshot.docs.map((snap)=>({id:snap.id,...snap.data()})); }
export async function getDocument(collectionName:string,id:string) { const snap=await getDoc(doc(db,collectionName,id)); return snap.exists()?{id:snap.id,...snap.data()}:null; }
export async function countDocuments(collectionName:string,filters:[string,any,any]=[]) { const snapshot=await getCountFromServer(buildQuery(collectionName,filters)); return snapshot.data().count; }
export async function addDocument(collectionName:string,data:Record<string,any>) { const ref=await addDoc(collection(db,collectionName),{...data,createdAt:serverTimestamp()}); return {id:ref.id,...data}; }
export async function setDocument(collectionName:string,id:string,data:Record<string,any>) { await setDoc(doc(db,collectionName,id),data,{merge:true}); return {id,...data}; }
export async function updateDocument(collectionName:string,id:string,data:Record<string,any>) { await updateDoc(doc(db,collectionName,id),data); return {id,...data}; }
export async function deleteDocument(collectionName:string,id:string) { await deleteDoc(doc(db,collectionName,id)); return true; }
export function generateId(collectionName:string) { return doc(collection(db,collectionName)).id; }
export type BatchOperation={type:'set';collectionName:string;id:string;data:Record<string,any>}|{type:'delete';collectionName:string;id:string};
const MAX_BATCH_OPERATIONS=500;
export async function batchWrite(operations:BatchOperation[]) { for(let i=0;i<operations.length;i+=MAX_BATCH_OPERATIONS){const chunk=operations.slice(i,i+MAX_BATCH_OPERATIONS);const batch=writeBatch(db);chunk.forEach(op=>{const ref=doc(db,op.collectionName,op.id);if(op.type==='set')batch.set(ref,op.data,{merge:true});else batch.delete(ref);});await batch.commit();} return true; }
