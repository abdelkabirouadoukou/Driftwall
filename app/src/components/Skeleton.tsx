/**
 * Skeleton loading primitives — flat surface blocks with a slow opacity pulse
 * (honoured by `prefers-reduced-motion` in theme.css).
 */

interface SkeletonProps {
  height?: number | string;
  width?: number | string;
  radius?: number | string;
}

export default function Skeleton({
  height = 16,
  width = '100%',
  radius,
}: SkeletonProps) {
  return (
    <div
      className="skeleton"
      aria-hidden="true"
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        width: typeof width === 'number' ? `${width}px` : width,
        borderRadius: radius,
      }}
    />
  );
}

/** Grid of skeleton tiles matching the wallpaper grid geometry. */
export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <ul className="grid" aria-busy="true" aria-label="Loading wallpapers">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="tile" style={{ pointerEvents: 'none' }}>
          <div className="tile-thumb">
            <Skeleton height="100%" width="100%" radius={0} />
          </div>
          <div className="tile-meta">
            <Skeleton height={13} width="70%" />
            <Skeleton height={11} width="40%" />
          </div>
        </li>
      ))}
    </ul>
  );
}
