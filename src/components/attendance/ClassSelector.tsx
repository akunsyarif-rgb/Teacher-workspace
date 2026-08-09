'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';

type ClassSelectorProps = {
  classes: string[];
  selected: string;
  onChange: (className: string) => void;
};

// Dropdown kelas yang bisa dicari — menggantikan baris chip horizontal
// yang tidak lagi praktis begitu guru punya banyak kelas (10-12+). Data
// tetap array className yang sudah ada, tidak ada perubahan model data.
export default function ClassSelector({ classes, selected, onChange }: ClassSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
    }
  }, [open]);

  function toggleOpen() {
    if (!open) setQuery('');
    setOpen(!open);
  }

  const filtered = classes.filter((cls) => cls.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        className="flex items-center justify-between gap-3 w-full sm:min-w-[240px] px-4 py-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl text-left transition-colors"
      >
        <span className="min-w-0">
          <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Kelas Aktif</span>
          <span className="block text-sm font-extrabold text-gray-900 truncate">
            {selected ? `Kelas ${selected}` : 'Pilih kelas...'}
          </span>
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-full sm:min-w-[280px] bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari kelas..."
                className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-base sm:text-xs font-bold text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-xs text-gray-400">Kelas tidak ditemukan.</p>
            ) : (
              filtered.map((cls) => (
                <button
                  key={cls}
                  type="button"
                  onClick={() => {
                    onChange(cls);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 text-xs font-bold text-left transition-colors ${
                    cls === selected ? 'text-blue-600 bg-blue-50' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="truncate">Kelas {cls}</span>
                  {cls === selected && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
