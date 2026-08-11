'use client';

import React from 'react';

type InputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  // Default browser tetap aktif (autocomplete/autocorrect/dst) — field
  // seperti rename kelas mematikannya secara eksplisit supaya kamus/koreksi
  // otomatis HP tidak diam-diam menyisipkan karakter aneh ke nilai yang
  // dikirim.
  autoComplete?: string;
  autoCorrect?: 'on' | 'off';
  autoCapitalize?: string;
  spellCheck?: boolean;
};

export default function Input({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  maxLength,
  autoComplete,
  autoCorrect,
  autoCapitalize,
  spellCheck,
}: InputProps) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-700 block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        autoCapitalize={autoCapitalize}
        spellCheck={spellCheck}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-base sm:text-xs text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
      />
    </div>
  );
}
