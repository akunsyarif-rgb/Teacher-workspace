'use client';

import React from 'react';

type TextareaProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
};

export default function Textarea({ label, value, onChange, placeholder, rows = 3 }: TextareaProps) {
  return (
    <div>
      <label className="text-xs font-bold text-nb-ink block mb-1">{label}</label>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-3 bg-nb-paper border border-nb-control rounded-xl text-base sm:text-sm text-nb-ink outline-none focus:bg-nb-paper focus:ring-2 focus:ring-nb-green"
      />
    </div>
  );
}
