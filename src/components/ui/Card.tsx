import React from 'react';

type CardProps = {
  children: React.ReactNode;
  className?: string;
};

export default function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`bg-[#FFFEF9] p-5 md:p-6 rounded-3xl border border-[#D9DED5] shadow-sm ${className}`}>
      {children}
    </div>
  );
}
