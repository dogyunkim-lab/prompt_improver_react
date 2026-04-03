import React from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js';
import type { ChartData } from '../../types';
import { BUCKET_COLORS } from '../../utils/constants';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface BucketBarChartProps {
  data: ChartData | null;
}

export const BucketBarChart: React.FC<BucketBarChartProps> = React.memo(({ data }) => {
  if (!data) return null;

  const colors = data.labels.map((l) => {
    const key = l.replace(/\s/g, '_').toLowerCase();
    return BUCKET_COLORS[key] || '#cba6f7';
  });

  const chartData = {
    labels: data.labels,
    datasets: [{
      data: data.values,
      backgroundColor: colors,
      borderRadius: 4,
    }],
  };

  return (
    <div className="relative h-[180px]">
      <Bar
        data={chartData}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, grid: { color: '#e8e4d920' } },
            y: { grid: { display: false } },
          },
        }}
      />
    </div>
  );
});

BucketBarChart.displayName = 'BucketBarChart';
