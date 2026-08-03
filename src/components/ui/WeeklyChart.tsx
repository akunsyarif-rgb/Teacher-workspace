'use client';

import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

type WeeklyChartProps = {
  labels: string[];
  journalData: number[];
  attendanceData: number[];
};

export default function WeeklyChart({ labels, journalData, attendanceData }: WeeklyChartProps) {
  const data = {
    labels,
    datasets: [
      {
        label: 'Jurnal',
        data: journalData,
        backgroundColor: 'rgba(59, 130, 246, 0.7)', // blue-500
        borderColor: 'rgb(59, 130, 246)',
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: 'Presensi',
        data: attendanceData,
        backgroundColor: 'rgba(16, 185, 129, 0.7)', // emerald-500
        borderColor: 'rgb(16, 185, 129)',
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          boxWidth: 12,
          padding: 8,
          font: { size: 10, weight: 'bold' as const },
        },
      },
      title: {
        display: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          stepSize: 1,
          font: { size: 9 },
        },
      },
      x: {
        ticks: {
          font: { size: 9 },
        },
      },
    },
  };

  return (
    <div className="w-full h-48 md:h-56">
      <Bar data={data} options={options} />
    </div>
  );
}
