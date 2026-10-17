import { Images, Settings as SettingsIcon, type LucideIcon } from 'lucide-react';

export type View = 'library' | 'settings';

interface NavItem {
  id: View;
  label: string;
  icon: LucideIcon;
}

const ITEMS: NavItem[] = [
  { id: 'library', label: 'Library', icon: Images },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

interface Props {
  view: View;
  onNavigate: (view: View) => void;
}

export default function Sidebar({ view, onNavigate }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Driftwall</span>
      </div>
      <nav className="nav">
        {ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={id === view ? 'nav-item active' : 'nav-item'}
            onClick={() => onNavigate(id)}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="brand-tag">Your desktop, alive.</div>
    </aside>
  );
}
