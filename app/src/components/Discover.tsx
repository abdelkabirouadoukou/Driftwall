import { Compass } from 'lucide-react';
import EmptyState from './EmptyState.tsx';

/**
 * Discover — full implementation lands in A3 (Wallhaven + Pixabay sources,
 * caching, rate limiting, infinite scroll, detail drawer). This is the
 * route placeholder so the shell and navigation are complete in A2.
 */
export default function Discover({ query }: { query: string }) {
  return (
    <section aria-label="Discover">
      <header className="page-head">
        <div>
          <h1>Discover</h1>
          <p className="sub">Wallhaven and Pixabay, cached for 24 hours.</p>
        </div>
      </header>
      <EmptyState
        icon={<Compass size={22} />}
        title="Discover is being built"
        body={
          query
            ? `Search “${query.trim()}” will run against Wallhaven and Pixabay once the source layer lands.`
            : 'Source providers, category filters, infinite scroll and one-click import arrive in the next step.'
        }
      />
    </section>
  );
}
