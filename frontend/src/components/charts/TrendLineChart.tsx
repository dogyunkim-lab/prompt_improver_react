import React from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler } from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

interface TrendLineChartProps {
  labels: string[];
  values: number[];
}

export const TrendLineChart: React.FC<TrendLineChartProps> = React.memo(({ labels, values }) => {
  if (labels.length < 2) {
    return (
      <div className="text-center text-warm-muted py-4 text-[13px]">
        첫 번째 Run입니다. 다음 Run부터 추이 비교가 가능합니다.
      </div>
    );
  }

  const chartData = {
    labels,
    datasets: [{
      data: values,
      borderColor: '#cba6f7',
      backgroundColor: 'rgba(203,166,247,0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 4,
      pointBackgroundColor: '#cba6f7',
    }],
  };

  return (
    <div className="relative h-[180px]">
      <Line
        data={chartData}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { min: 0, max: 100, grid: { color: '#e8e4d920' } },
            x: { grid: { display: false } },
          },
        }}
      />
    </div>
  );
});

TrendLineChart.displayName = 'TrendLineChart';
