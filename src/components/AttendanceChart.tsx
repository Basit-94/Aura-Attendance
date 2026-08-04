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
          <defs>
            {/* Gradient for bars meeting target (Teal to Cyan-Green) */}
            <linearGradient id="meetsTargetGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.95} />
              <stop offset="60%" stopColor="#0ea5e9" stopOpacity={0.8} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.4} />
            </linearGradient>
            
            {/* Gradient for bars failing target (Rose to Sunset Orange) */}
            <linearGradient id="failsTargetGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.95} />
              <stop offset="60%" stopColor="#e11d48" stopOpacity={0.8} />
              <stop offset="100%" stopColor="#fb923c" stopOpacity={0.4} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.03)" />
          
          <XAxis
            dataKey="name"
            stroke="var(--text-muted)"
            fontSize={11}
            fontWeight={500}
            tickLine={false}
            height={60}
            angle={-20}
            textAnchor="end"
          />
          
          <YAxis
            stroke="var(--text-muted)"
            domain={[0, 100]}
            fontSize={10}
            tickLine={false}
            axisLine={false}
          />
          
          <Tooltip
            contentStyle={{
              background: 'rgba(15, 23, 42, 0.95)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              color: '#f8fafc',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
              padding: '10px 14px',
            }}
            cursor={{ fill: 'rgba(255, 255, 255, 0.02)' }}
          />
          
          <ReferenceLine
            y={criteriaA}
            label={{
              value: `Primary Target (${criteriaA}%)`,
              position: 'insideTopRight',
              fill: 'rgba(99, 102, 241, 0.85)',
              fontSize: 10,
              fontWeight: 600,
            }}
            stroke="rgba(99, 102, 241, 0.5)"
            strokeDasharray="4 4"
            strokeWidth={1.5}
          />
          
          <ReferenceLine
            y={criteriaB}
            label={{
              value: `Secondary Target (${criteriaB}%)`,
              position: 'insideBottomRight',
              fill: 'rgba(244, 63, 94, 0.85)',
              fontSize: 10,
              fontWeight: 600,
            }}
            stroke="rgba(244, 63, 94, 0.5)"
            strokeDasharray="4 4"
            strokeWidth={1.5}
          />
          
          <Bar dataKey="percentage" radius={[6, 6, 0, 0]}>
            {subjects.map((s, index) => {
              const meetsTarget = s.stats.percentage >= s.targetPercentage;
              return (
                <Cell
                  key={`cell-${index}`}
                  fill={meetsTarget ? 'url(#meetsTargetGrad)' : 'url(#failsTargetGrad)'}
                  stroke={meetsTarget ? '#22d3ee' : '#fb7185'}
                  strokeWidth={1}
                  style={{ filter: 'drop-shadow(0px 2px 8px rgba(0, 0, 0, 0.35))' }}
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
