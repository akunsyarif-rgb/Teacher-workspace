import React from 'react';

type CardProps = {
  children: React.ReactNode;
  className?: string;
};

export default function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`bg-white p-6 rounded-3xl border border-gray-100 shadow-sm ${className}`}>
      {children}
    </div>
  );
}
