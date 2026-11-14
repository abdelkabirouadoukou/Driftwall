import { Island } from "@thexjs/core";
import {
  BatteryCharging,
  Compass,
  Download,
  ExternalLink,
  LibraryBig,
  type LucideIcon,
  Monitor,
  Music2,
  PanelTop,
  PlayCircle,
  RefreshCw,
  Repeat,
  Shapes,
} from "lucide-react";
import AuroraField from "../components/aurora-field";
import SiteMeta from "../components/site-meta";

export const mode = "static";

export const islands = { AuroraField, SiteMeta };

const REPO = "https://github.com/abdelkabirouadoukou/Driftwall";
const RELEASES = `${REPO}/releases/latest`;

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Compass,
    title: "Discover",
    desc: "Free wallpapers and looping videos from Wallhaven, Pexels, Bing, NASA and Pixabay. Safe-for-work filtering built in.",
  },
  {
    icon: LibraryBig,
    title: "Library",
    desc: "Drag in your own images and videos. Filter, sort, multi-select, rename, and preview clips on hover.",
  },
  {
    icon: PlayCircle,
    title: "Live wallpapers",
    desc: "Video plays behind your desktop icons, one light window per display, with a watchdog that revives a frozen clip.",
  },
  {
    icon: Shapes,
    title: "Scenes",
    desc: "Aurora, Nebula, Deep waves, Starfield, Drift and Night rain — drawn on a canvas, so almost no storage.",
  },
  {
    icon: Repeat,
    title: "Rotation",
    desc: "Pick a set and an interval. Missing files are skipped, never fatal.",
  },
  {
    icon: Music2,
    title: "Music",
    desc: "Paste a YouTube link or add audio files. Shuffle, repeat, a real seek bar, and a now-playing bar that takes the colour of the video.",
  },
  {
    icon: Monitor,
    title: "Displays",
    desc: "Choose what each monitor shows.",
  },
  {
    icon: BatteryCharging,
    title: "Power-aware",
    desc: "Pauses live wallpapers on battery, below a charge threshold, or in Low Power Mode. You set the policy.",
  },
  {
    icon: PanelTop,
    title: "Menu-bar panel",
    desc: "Quick controls for wallpapers and music, rounded and out of the way, without opening the main window.",
  },
  {
    icon: RefreshCw,
    title: "Auto-updates",
    desc: "Driftwall checks GitHub for new, signed releases and installs them in place — no manual re-downloads.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Pick",
    desc: "Browse Discover, drop in your own clip, or choose a built-in scene.",
  },
  {
    n: "02",
    title: "Preview fast",
    desc: "A still appears instantly; the animation fades in once it has loaded.",
  },
  {
    n: "03",
    title: "Set & forget",
    desc: "It plays behind your icons and pauses itself when your battery needs it.",
  },
];

export default function Home() {
  return (
    <>
      <Island name="SiteMeta" client="load">
        <SiteMeta />
      </Island>

      <section className="glow relative overflow-hidden px-5 pt-20 pb-20 text-center sm:pt-28">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-70">
          <Island name="AuroraField" client="idle">
            <AuroraField />
          </Island>
        </div>

        <div className="relative mx-auto max-w-3xl">
          <img src="/logo.svg" alt="Driftwall logo" width={88} height={88} className="mx-auto" />
          <p className="mt-8 font-mono text-xs uppercase tracking-widest text-teal">
            macOS 12+ · Apple Silicon &amp; Intel
          </p>
          <h1 className="text-balance mt-4 text-4xl font-bold tracking-tight sm:text-6xl">
            Your desktop, alive.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            Static and animated wallpapers for your Mac. Power-aware, watermark-free by design,
            and light on memory.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={RELEASES}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-ink transition-opacity hover:opacity-90"
            >
              <Download size={18} aria-hidden="true" />
              Download for macOS
            </a>
            <a
              href={REPO}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-2 px-6 font-semibold transition-colors hover:bg-surface-2"
            >
              <ExternalLink size={18} aria-hidden="true" />
              View on GitHub
            </a>
          </div>
          <p className="mt-4 text-xs text-muted">
            No DRM. No watermark. Unsigned build the first time? Right-click the app and choose
            Open.
          </p>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16">
        <h2 className="text-3xl font-semibold tracking-tight">
          Everything a wallpaper app should do
        </h2>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <li
              key={title}
              className="rounded-2xl border border-line bg-surface p-6 transition-colors duration-200 hover:border-line-2"
            >
              <Icon size={24} className="text-primary" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{desc}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16">
        <div className="rounded-2xl border border-line bg-surface p-8 sm:p-12">
          <h2 className="text-3xl font-semibold tracking-tight">Live, without the drain</h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n}>
                <span className="font-mono text-sm text-teal">{step.n}</span>
                <h3 className="mt-2 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted">{step.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Give your desktop some life</h2>
        <a
          href={RELEASES}
          className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-ink transition-opacity hover:opacity-90"
        >
          <Download size={18} aria-hidden="true" />
          Get the latest release
        </a>
      </section>
    </>
  );
}
