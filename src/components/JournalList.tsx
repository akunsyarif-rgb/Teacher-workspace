"use client";

import React, { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/src/config/firebase";
import { Calendar, BookOpen, FileText } from "lucide-react";

export default function JournalList() {
  const [journals, setJournals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchJournals = async () => {
      try {
        const q = query(collection(db, "journals"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        const data = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setJournals(data);
      } catch (error) {
        console.error("Gagal memuat jurnal:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchJournals();
  }, []);

  if (loading) {
    return <div className="text-center py-8 text-xs text-gray-500">Memuat riwayat jurnal...</div>;
  }

  if (journals.length === 0) {
    return <div className="text-center py-8 text-xs text-gray-500 bg-white rounded-2xl border border-gray-100">Belum ada jurnal yang tercatat.</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 mt-8">
      <h3 className="text-sm font-bold text-gray-900 mb-2">Riwayat Jurnal Mengajar</h3>
      {journals.map((item) => (
        <div key={item.id} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-3">
          <div className="flex justify-between items-center">
            <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold">
              Kelas {item.className}
            </span>
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString("id-ID", { day: 'numeric', month: 'short', year: 'numeric' }) : "Baru saja"}
            </span>
          </div>

          <div>
            <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600" />
              {item.subject}
            </h4>
            <p className="text-xs font-medium text-gray-700 mt-1">Topik: {item.topic}</p>
          </div>

          {item.notes && (
            <div className="p-3 bg-gray-50 rounded-xl flex items-start gap-2 text-xs text-gray-600">
              <FileText className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
              <span>{item.notes}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
