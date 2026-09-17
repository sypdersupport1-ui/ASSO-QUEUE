import React from 'react';

interface KPICardProps {
  title: string;
  value: string | number;
  description?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

export function KPICard({ title, value, description, trend }: KPICardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col">
      <h3 className="text-sm font-medium text-gray-500">{title}</h3>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-gray-900">{value}</span>
        {trend && (
          <span className={`text-sm font-medium ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {trend.isPositive ? '+' : '-'}{Math.abs(trend.value)}%
          </span>
        )}
      </div>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
    </div>
  );
}
