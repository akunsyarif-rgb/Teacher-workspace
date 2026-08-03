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
      <label className="text-xs font-bold text-gray-700 block mb-1">{label}</label>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
      />
    </div>
  );
}
