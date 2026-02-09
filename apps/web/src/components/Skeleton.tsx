import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'rectangular' | 'circular';
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  className = '',
  variant = 'text',
  width,
  height,
}: SkeletonProps) {
  const baseClasses = 'animate-pulse bg-gray-700';
  const variantClasses = {
    text: 'rounded',
    rectangular: 'rounded-lg',
    circular: 'rounded-full',
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      style={style}
    />
  );
}

export function MessageSkeleton() {
  return (
    <div className="flex gap-3 p-4">
      <Skeleton variant="circular" width={32} height={32} />
      <div className="flex-1 space-y-2">
        <Skeleton height={16} width="30%" />
        <Skeleton height={14} width="100%" />
        <Skeleton height={14} width="80%" />
      </div>
    </div>
  );
}

export function ActionSkeleton() {
  return (
    <div className="p-4 bg-gray-800 rounded-lg space-y-2">
      <div className="flex justify-between">
        <Skeleton height={16} width="40%" />
        <Skeleton height={16} width={60} />
      </div>
      <Skeleton height={14} width="100%" />
      <Skeleton height={14} width="60%" />
    </div>
  );
}
