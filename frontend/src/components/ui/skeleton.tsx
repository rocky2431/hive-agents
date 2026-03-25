import * as React from 'react';
import { cn } from '@/lib/cn';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-hover', className)}
      aria-busy="true"
      {...props}
    />
  );
}

export { Skeleton };
