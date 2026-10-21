import {
  Compass,
  Home as HomeIcon,
  Images,
  Monitor,
  Music,
  Sparkles,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';

export type View = 'home' | 'discover' | 'library' | 'displays' | 'music' | 'scenes' | 'settings';

export interface NavItem {
  id: View;
  label: string;
  icon: LucideIcon;
  /** 1-based digit of the Cmd+<n> shortcut. */
  shortcut: string;
  /** Sidebar section the item sits in. */
  group: 'wallpapers' | 'media' | 'system';
}

/** Sidebar order doubles as the Cmd+1..Cmd+7 navigation order. */
export const NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: HomeIcon, shortcut: '1', group: 'wallpapers' },
  { id: 'discover', label: 'Discover', icon: Compass, shortcut: '2', group: 'wallpapers' },
  { id: 'library', label: 'Library', icon: Images, shortcut: '3', group: 'wallpapers' },
  { id: 'scenes', label: 'Scenes', icon: Sparkles, shortcut: '4', group: 'wallpapers' },
  { id: 'music', label: 'Music', icon: Music, shortcut: '5', group: 'media' },
  { id: 'displays', label: 'Displays', icon: Monitor, shortcut: '6', group: 'system' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, shortcut: '7', group: 'system' },
];

const GROUPS: { id: NavItem['group']; label: string }[] = [
  { id: 'wallpapers', label: 'Wallpapers' },
  { id: 'media', label: 'Media' },
  { id: 'system', label: 'System' },
];

interface Props {
  view: View;
  onNavigate: (view: View) => void;
}

export default function Sidebar({ view, onNavigate }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-mark" src="/logo.svg" alt="" width={26} height={26} />
        <span className="brand-name">Driftwall</span>
      </div>
      <nav className="nav" aria-label="Main">
        {GROUPS.map((group) => (
          <div key={group.id} className="nav-group">
            <div className="nav-label">{group.label}</div>
            {NAV.filter((item) => item.group === group.id).map(
              ({ id, label, icon: Icon, shortcut }) => (
                <button
                  key={id}
                  type="button"
                  className={id === view ? 'nav-item active' : 'nav-item'}
                  aria-current={id === view ? 'page' : undefined}
                  aria-keyshortcuts={`Meta+${shortcut}`}
                  title={`${label} (⌘${shortcut})`}
                  onClick={() => onNavigate(id)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ),
            )}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">Your desktop, alive.</div>
    </aside>
  );
}
