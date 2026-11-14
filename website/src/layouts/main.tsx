import { Download, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

const REPO = "https://github.com/abdelkabirouadoukou/Driftwall";

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-ink"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <nav
          className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5"
          aria-label="Main"
        >
          <a href="/" className="flex items-center gap-3 font-semibold">
            <img src="/logo.svg" alt="" width={28} height={28} />
            Driftwall
          </a>
          <div className="flex items-center gap-6 text-sm text-muted">
            <a className="hidden transition-colors hover:text-ink sm:inline" href="/#features">
              Features
            </a>
            <a className="hidden transition-colors hover:text-ink sm:inline" href="/#how">
              How it works
            </a>
            <a
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-ink transition-opacity hover:opacity-90"
              href={`${REPO}/releases/latest`}
            >
              <Download size={15} aria-hidden="true" />
              Download
            </a>
          </div>
        </nav>
      </header>

      <main id="main">{children}</main>

      <footer className="border-t border-line px-5 py-10 text-sm text-muted">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="flex items-center gap-2">
            <img src="/logo.svg" alt="" width={18} height={18} />
            Driftwall · Tauri 2, React 19 and Rust
          </p>
          <a
            className="inline-flex items-center gap-2 transition-colors hover:text-ink"
            href={REPO}
          >
            <ExternalLink size={15} aria-hidden="true" />
            Source on GitHub
          </a>
        </div>
      </footer>
    </>
  );
}
