'use client';

import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

type AttendanceTrendChartProps = {
  labels: string[];
  rates: number[];
};

export default function AttendanceTrendChart({ labels, rates }: AttendanceTrendChartProps) {
  const data = {
    labels,
    datasets: [
      {
        label: 'Kehadiran (%)',
        data: rates,
        backgroundColor: 'rgba(16, 185, 129, 0.7)',
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
      legend: { display: false },
    },
    scales: {
      // Dipatok 0-100 karena satuannya persen — sumbu otomatis akan
      // membuat 95% dan 100% terlihat berbeda jauh.
      y: {
        min: 0,
        max: 100,
        ticks: { stepSize: 25, font: { size: 9 } },
      },
      x: {
        ticks: { font: { size: 9 } },
      },
    },
  };

  return (
    <div className="w-full h-44">
      <Bar data={data} options={options} />
    </div>
  );
}
