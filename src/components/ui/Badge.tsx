import React from 'react';

type BadgeProps = {
  label: string;
  color?: 'blue' | 'amber' | 'purple' | 'teal' | 'red' | 'emerald';
};

const COLOR_CLASS: Record<string, string> = {
  blue: 'bg-[#EDF3E8] text-[#24563F]',
  amber: 'bg-amber-50 text-amber-800',
  purple: 'bg-purple-50 text-purple-700',
  teal: 'bg-teal-50 text-teal-700',
  red: 'bg-red-50 text-red-700',
  emerald: 'bg-[#EDF3E8] text-[#24563F]',
};

export default function Badge({ label, color = 'blue' }: BadgeProps) {
  return (
    <span className={`px-2 py-1 rounded-md text-xs font-extrabold ${COLOR_CLASS[color]}`}>
      {label}
    </span>
  );
}
