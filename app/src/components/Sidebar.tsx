import {
  Compass,
  Home as HomeIcon,
  Images,
  Monitor,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';

export type View = 'home' | 'discover' | 'library' | 'displays' | 'settings';

export interface NavItem {
  id: View;
  label: string;
  icon: LucideIcon;
  /** 1-based digit shown in Cmd+<n> shortcut hints. */
  shortcut: string;
}

/** Sidebar order doubles as the Cmd+1..Cmd+5 navigation order. */
export const NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: HomeIcon, shortcut: '1' },
  { id: 'discover', label: 'Discover', icon: Compass, shortcut: '2' },
  { id: 'library', label: 'Library', icon: Images, shortcut: '3' },
  { id: 'displays', label: 'Displays', icon: Monitor, shortcut: '4' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, shortcut: '5' },
];

interface Props {
  view: View;
  onNavigate: (view: View) => void;
}

export default function Sidebar({ view, onNavigate }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-mark" src="/logo.svg" alt="" width={28} height={28} />
        <span className="brand-name">Driftwall</span>
      </div>
      <nav className="nav" aria-label="Main">
        {NAV.map(({ id, label, icon: Icon, shortcut }) => (
          <button
            key={id}
            type="button"
            className={id === view ? 'nav-item active' : 'nav-item'}
            aria-current={id === view ? 'page' : undefined}
            onClick={() => onNavigate(id)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
            <span className="spacer" />
            <span className="kbd" aria-hidden="true">
              ⌘{shortcut}
            </span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">Your desktop, alive.</div>
    </aside>
  );
}
