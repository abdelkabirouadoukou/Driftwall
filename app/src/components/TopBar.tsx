import { type RefObject } from 'react';
import { Search, X } from 'lucide-react';

interface Props {
  query: string;
  onQuery: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export default function TopBar({ query, onQuery, inputRef }: Props) {
  return (
    <div className="topbar">
      <div className="search">
        <Search className="search-icon" size={15} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search wallpapers…"
          aria-label="Search wallpapers"
        />
      </div>
      <span className="spacer" />
      <button
        type="button"
        className="btn ghost"
        onClick={() => inputRef.current?.focus()}
        aria-label="Focus search (Command F)"
      >
        <Search size={15} aria-hidden="true" />
        <span className="kbd">⌘F</span>
      </button>
      {query.length > 0 && (
        <button
          type="button"
          className="btn icon ghost"
          onClick={() => onQuery('')}
          aria-label="Clear search"
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
