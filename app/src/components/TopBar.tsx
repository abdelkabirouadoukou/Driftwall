import { type RefObject } from 'react';
import { Search, X } from 'lucide-react';
import { DownloadsButton } from './Downloads.tsx';

interface Props {
  query: string;
  onQuery: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export default function TopBar({ query, onQuery, inputRef }: Props) {
  return (
    <div className="topbar" data-tauri-drag-region>
      <span className="spacer" data-tauri-drag-region />
      <div className="search">
        <Search className="search-icon" size={15} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search wallpapers"
          aria-label="Search wallpapers"
          spellCheck={false}
          autoComplete="off"
        />
        {query.length > 0 ? (
          <button
            type="button"
            className="search-clear"
            onClick={() => onQuery('')}
            aria-label="Clear search"
          >
            <X size={13} aria-hidden="true" />
          </button>
        ) : (
          <span className="kbd search-kbd" aria-hidden="true">
            ⌘F
          </span>
        )}
      </div>
      <span className="spacer" data-tauri-drag-region />
      <DownloadsButton />
    </div>
  );
}
