'use client';

import React from 'react';

type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
};

export default function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  loading = false,
  disabled = false,
}: ButtonProps) {
  const baseClass =
    'w-full py-3 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2';
  const variantClass =
    variant === 'primary'
      ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white shadow-sm'
      : 'bg-gray-100 hover:bg-gray-200 text-gray-700';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseClass} ${variantClass}`}
    >
      {children}
    </button>
  );
}
