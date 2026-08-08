'use client';

import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

type GradeTrendChartProps = {
  labels: string[];
  scores: number[];
};

export default function GradeTrendChart({ labels, scores }: GradeTrendChartProps) {
  const data = {
    labels,
    datasets: [
      {
        label: 'Nilai',
        data: scores,
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.15)',
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: 'rgb(59, 130, 246)',
        tension: 0.3,
        fill: true,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      // Skala nilai sekolah 0-100 dipatok tetap: kalau dibiarkan otomatis,
      // selisih 2 poin bisa terlihat seperti lonjakan besar dan siswa
      // salah membaca perkembangannya sendiri.
      y: {
        min: 0,
        max: 100,
        ticks: { stepSize: 25, font: { size: 9 } },
      },
      x: {
        ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 0 },
      },
    },
  };

  return (
    <div className="w-full h-44">
      <Line data={data} options={options} />
    </div>
  );
}
