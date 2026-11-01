import { Session, SessionError, type Deps } from "./session.ts";

// The challenge lives in the visitor's browser (localStorage), so the game needs no server state
// and survives a reload. It is the visitor's own demo state: it is checked when read back (a broken
// or old save starts a new challenge), not protected from them.

export const STORAGE_KEY = "complier-landing-game";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Returns false if the browser wouldn't store it (private mode, full storage); the game goes on.
export function saveChallenge(storage: StorageLike | undefined, s: Session): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(s.save()));
    return true;
  } catch {
    return false;
  }
}

// The saved challenge, or why it couldn't be used (it is removed then). Nothing saved: neither.
export function loadChallenge(storage: StorageLike | undefined, deps: Deps = {}): { session?: Session; reset?: string } {
  let raw: string | null;
  try {
    raw = storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return {};
  }
  if (raw === null) return {};
  try {
    return { session: Session.restore(JSON.parse(raw), deps) };
  } catch (e) {
    clearChallenge(storage);
    return { reset: e instanceof SessionError ? e.message : "it wasn't readable" };
  }
}

export function clearChallenge(storage: StorageLike | undefined) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {}
}
