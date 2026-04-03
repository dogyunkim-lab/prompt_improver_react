import React from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import type { ChartData } from '../../types';
import { EVAL_COLORS } from '../../utils/constants';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface EvalBarChartProps {
  data: ChartData | null;
}

export const EvalBarChart: React.FC<EvalBarChartProps> = React.memo(({ data }) => {
  if (!data) return <div className="text-warm-muted text-center py-8 text-sm">데이터 없음</div>;

  const chartData = {
    labels: data.labels,
    datasets: [{
      data: data.values,
      backgroundColor: data.labels.map((l) => (EVAL_COLORS as Record<string, string>)[l] || '#cba6f7'),
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
          plugins: { legend: { display: false }, tooltip: { enabled: true } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#e8e4d920' } },
            x: { grid: { display: false } },
          },
        }}
      />
    </div>
  );
});

EvalBarChart.displayName = 'EvalBarChart';
