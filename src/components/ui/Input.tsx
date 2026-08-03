'use client';

import React from 'react';

type InputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
};

export default function Input({ label, value, onChange, type = 'text', placeholder, required }: InputProps) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-700 block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
      />
    </div>
  );
}
