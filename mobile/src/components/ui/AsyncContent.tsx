import type { ReactNode } from 'react';

import type { IconName } from '../../lib/design';
import { Banner } from './Banner';
import { EmptyState } from './EmptyState';
import { SkeletonRows } from './Skeleton';

export interface AsyncContentProps<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** True when there is nothing to show (e.g. an empty list). */
  isEmpty?: (data: T) => boolean;
  empty: { icon: IconName; title: string; message?: string; action?: { label: string; onPress: () => void } };
  skeletonRows?: number;
  children: (data: T) => ReactNode;
}

/** The four states every list has: loading skeleton, error with Retry, empty, content.
 *  An error while old data is on screen shows a banner above the stale data. */
export function AsyncContent<T>({ data, loading, error, onRetry, isEmpty, empty, skeletonRows = 3, children }: AsyncContentProps<T>) {
  if (loading) return <SkeletonRows rows={skeletonRows} />;
  const errorBanner = error ? (
    <Banner
      tone="danger"
      title={data === undefined ? "Couldn't load this" : "Couldn't refresh"}
      message={error}
      action={{ label: 'Retry', onPress: onRetry }}
    />
  ) : null;
  if (data === undefined) return errorBanner;
  if (isEmpty?.(data)) {
    return (
      <>
        {errorBanner}
        <EmptyState icon={empty.icon} title={empty.title} message={empty.message} action={empty.action} compact />
      </>
    );
  }
  return (
    <>
      {errorBanner}
      {children(data)}
    </>
  );
}
