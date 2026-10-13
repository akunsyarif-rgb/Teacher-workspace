'use client';

import React from 'react';

type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary';
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
    'w-full min-h-11 py-3 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#2F6B4F]';
  const variantClass =
    variant === 'primary'
      ? 'bg-[#2F6B4F] hover:bg-[#24563F] disabled:bg-[#B6C8B8] text-white shadow-sm'
      : 'bg-[#F0EEE6] hover:bg-[#E7E5DC] text-[#242923]';

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
