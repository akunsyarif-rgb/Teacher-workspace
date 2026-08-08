'use client';

import React from 'react';
import { AlertCircle, X } from 'lucide-react';

type InlineAlertProps = {
  message: string;
  onDismiss?: () => void;
};

export default function InlineAlert({ message, onDismiss }: InlineAlertProps) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="p-3.5 bg-red-50 border border-red-100 rounded-2xl text-xs font-bold text-red-600 flex items-center gap-2"
    >
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="p-2 -m-1 hover:bg-red-100 rounded-lg shrink-0 transition-colors active:scale-90"
          aria-label="Tutup pesan"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
