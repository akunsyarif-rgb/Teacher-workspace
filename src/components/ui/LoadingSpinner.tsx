'use client';

import React from 'react';

type LoadingSpinnerProps = {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
};

export default function LoadingSpinner({ size = 'md', text = 'Memuat...' }: LoadingSpinnerProps) {
  const sizeClass = {
    sm: 'w-6 h-6 border-2',
    md: 'w-10 h-10 border-4',
    lg: 'w-16 h-16 border-4',
  }[size];

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div className={`${sizeClass} border-blue-600 border-t-transparent rounded-full animate-spin`} />
      <p className="text-xs font-bold text-gray-500">{text}</p>
    </div>
  );
}
