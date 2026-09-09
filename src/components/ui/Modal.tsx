'use client';

import React from 'react';
import { X } from 'lucide-react';

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

export default function Modal({ isOpen, onClose, title, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-md w-full max-h-[90vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header sticky supaya tombol tutup tetap terjangkau walau isi
            modal (mis. preview instruksi tugas yang sangat panjang) lebih
            tinggi dari layar — tanpa ini kartu modal cuma memanjang ke
            bawah tanpa batas dan tombol aksi di paling bawah (mis. Publish
            Tugas) jadi tidak pernah kelihatan maupun bisa dicapai scroll. */}
        <div className="flex items-start justify-between gap-3 p-6 pb-0 shrink-0">
          <h3 className="text-sm font-bold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2.5 -m-1.5 -mt-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors active:scale-90 shrink-0"
            aria-label="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 pt-4 space-y-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
