/**
 * Checks Driftwall's GitHub releases for a newer, signed build and installs
 * it. Wraps `@tauri-apps/plugin-updater` so the rest of the app only deals
 * with a small, typed surface.
 */
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UpdateInfo {
  version: string;
  notes?: string;
  update: Update;
}

/** Null when already on the latest version, or the check could not run. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  if (!update?.available) return null;
  return { version: update.version, notes: update.body, update };
}

/** Downloads and installs the update, then relaunches the app. */
export async function installUpdate(info: UpdateInfo): Promise<void> {
  await info.update.downloadAndInstall();
  await relaunch();
}
