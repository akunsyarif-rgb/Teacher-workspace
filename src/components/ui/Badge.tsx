import React from 'react';

type BadgeProps = {
  label: string;
  color?: 'blue' | 'amber' | 'purple' | 'teal' | 'red' | 'emerald';
};

const COLOR_CLASS: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  purple: 'bg-purple-50 text-purple-600',
  teal: 'bg-teal-50 text-teal-600',
  red: 'bg-red-50 text-red-600',
  emerald: 'bg-emerald-50 text-emerald-600',
};

export default function Badge({ label, color = 'blue' }: BadgeProps) {
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${COLOR_CLASS[color]}`}>
      {label}
    </span>
  );
}
