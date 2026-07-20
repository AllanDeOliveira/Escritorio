import { Loader2 } from 'lucide-react';

export default function SkeletonPetition({ phrase }: { phrase: string }) {
  return (
    <div className="lx-skeleton-wrap" style={{ flex: 1, margin: '1rem' }}>
      <div className="lx-skeleton-overlay">
        <div className="lx-skeleton-phrase-badge">
          <Loader2 className="lx-spin" size={18} />
          <span>{phrase}</span>
        </div>
      </div>
      <div className="lx-skeleton-header">
        <div className="lx-skeleton-logo lx-skeleton-shimmer"></div>
        <div style={{ width: '200px', height: '24px' }} className="lx-skeleton-shimmer"></div>
      </div>
      <div className="lx-skeleton-title lx-skeleton-shimmer"></div>
      <div className="lx-skeleton-subtitle lx-skeleton-shimmer"></div>
      <div style={{ marginTop: '1rem' }}>
        <div className="lx-skeleton-paragraph lx-skeleton-p1 lx-skeleton-shimmer"></div>
        <div className="lx-skeleton-paragraph lx-skeleton-p2 lx-skeleton-shimmer"></div>
        <div className="lx-skeleton-paragraph lx-skeleton-p4 lx-skeleton-shimmer"></div>
        <div className="lx-skeleton-paragraph lx-skeleton-p3 lx-skeleton-shimmer"></div>
      </div>
      <div style={{ marginTop: '2rem' }}>
        <div className="lx-skeleton-paragraph lx-skeleton-p2 lx-skeleton-shimmer"></div>
        <div className="lx-skeleton-paragraph lx-skeleton-p3 lx-skeleton-shimmer"></div>
        <div className="lx-skeleton-paragraph lx-skeleton-p1 lx-skeleton-shimmer"></div>
      </div>
      <div className="lx-skeleton-signature lx-skeleton-shimmer"></div>
    </div>
  );
}
