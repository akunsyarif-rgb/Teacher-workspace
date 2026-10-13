'use client';

import React from 'react';

type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'notebook';
  loading?: boolean;
  disabled?: boolean;
  className?: string; // TAMBAH: menerima className custom
};

export default function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  loading = false,
  disabled = false,
  className = '', // default kosong
}: ButtonProps) {
  const baseClass =
    'w-full py-3 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 active:scale-[0.97]';
  const variantClass =
    variant === 'primary'
      ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white shadow-sm'
      : variant === 'notebook'
        ? 'bg-[#2F6B4F] hover:bg-[#24563F] disabled:bg-[#A7B9AD] text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6B4F] focus-visible:ring-offset-2'
        : 'bg-gray-100 hover:bg-gray-200 text-gray-700';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseClass} ${variantClass} ${className}`}
    >
      {children}
    </button>
  );
}
