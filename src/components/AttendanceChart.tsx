'use client';

import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
  Cell
} from 'recharts';

interface SubjectChartData {
  name: string;
  targetPercentage: number;
  stats: {
    percentage: number;
  };
}

interface AttendanceChartProps {
  subjects: SubjectChartData[];
  criteriaA: number;
  criteriaB: number;
}

export default function AttendanceChart({ subjects, criteriaA, criteriaB }: AttendanceChartProps) {
  if (!subjects || subjects.length === 0) {
    return (
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        Add subjects to view charts.
      </p>
    );
  }

  const chartData = subjects.map((s) => ({
    name: s.name,
    percentage: s.stats.percentage,
    target: s.targetPercentage,
  }));

  return (
    <div style={{ width: '100%', height: 320, minWidth: '280px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 20, left: -20, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="name"
            stroke="var(--text-secondary)"
            fontSize={11}
            fontWeight={500}
            tickLine={false}
            height={60}
            angle={-20}
            textAnchor="end"
          />
          <YAxis
            stroke="var(--text-secondary)"
            domain={[0, 100]}
            fontSize={10}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-card)',
              borderColor: 'var(--border-color)',
              borderRadius: 'var(--border-radius-sm)',
              color: 'var(--text-primary)',
            }}
          />
          <ReferenceLine
            y={criteriaA}
            label={{
              value: `Primary Target (${criteriaA}%)`,
              position: 'insideTopLeft',
              fill: 'var(--danger)',
              fontSize: 10,
              fontWeight: 600,
            }}
            stroke="var(--danger)"
            strokeDasharray="4 4"
          />
          <ReferenceLine
            y={criteriaB}
            label={{
              value: `Secondary Target (${criteriaB}%)`,
              position: 'insideBottomLeft',
              fill: 'var(--warning)',
              fontSize: 10,
              fontWeight: 600,
            }}
            stroke="var(--warning)"
            strokeDasharray="4 4"
          />
          <Bar dataKey="percentage" radius={[4, 4, 0, 0]}>
            {subjects.map((s, index) => {
              const meetsTarget = s.stats.percentage >= s.targetPercentage;
              return (
                <Cell
                  key={`cell-${index}`}
                  fill={meetsTarget ? 'var(--success)' : 'var(--danger)'}
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
