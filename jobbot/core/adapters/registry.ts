import type { SiteAdapter } from "./types";
import { linkedinAdapter } from "./linkedin";
import { indeedAdapter } from "./indeed";
import { alljobsAdapter, drushimAdapter, gotfriendsAdapter } from "./stubs";
import { elbitAdapter } from "./elbit";
import { iaiAdapter } from "./iai";

const adapters: SiteAdapter[] = [
  linkedinAdapter,
  indeedAdapter,
  alljobsAdapter,
  drushimAdapter,
  gotfriendsAdapter,
  elbitAdapter,
  iaiAdapter,
];

export function listAdapters(): SiteAdapter[] {
  return [...adapters];
}

export function getAdapter(id: string): SiteAdapter | undefined {
  return adapters.find((a) => a.id === id);
}

export function registerAdapter(adapter: SiteAdapter): void {
  const idx = adapters.findIndex((a) => a.id === adapter.id);
  if (idx >= 0) adapters[idx] = adapter;
  else adapters.push(adapter);
}
