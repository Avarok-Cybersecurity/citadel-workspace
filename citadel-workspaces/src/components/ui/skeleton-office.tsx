import React from 'react';
import { Skeleton } from './skeleton';

/**
 * Skeleton component for office loading states
 * Provides a visual placeholder while office data is being loaded
 */
export const OfficeSkeletonLoader: React.FC = () => {
  return (
    <div className="w-full p-4 space-y-6">
      {/* Office header skeleton */}
      <div className="flex items-center space-x-4 mb-6">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      
      {/* Office content skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array(6).fill(0).map((_, i) => (
          <div key={i} className="border rounded-lg p-4 bg-card">
            <Skeleton className="h-4 w-1/2 mb-4" />
            <Skeleton className="h-20 w-full mb-4" />
            <div className="flex space-x-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          </div>
        ))}
      </div>
      
      {/* Action button skeletons */}
      <div className="flex space-x-3 mt-6">
        <Skeleton className="h-10 w-28 rounded-md" />
        <Skeleton className="h-10 w-28 rounded-md" />
      </div>
    </div>
  );
};
