"use client";

import { createContext, useContext, useEffect } from "react";

export type CrumbState = {
  /** The protocol being shown: its code, or its title until a code is assigned. */
  protocol: { id: string; label: string } | null;
  /** The page below a protocol tab, such as one form. */
  leaf: string | null;
};

export const EMPTY_CRUMBS: CrumbState = { protocol: null, leaf: null };

export const CrumbSetter = createContext<(update: (current: CrumbState) => CrumbState) => void>(() => {});

/** Rendered by the protocol layout so the top bar can name the protocol. */
export function ProtocolCrumb({ id, label }: { id: string; label: string }) {
  const set = useContext(CrumbSetter);
  useEffect(() => {
    set((current) => ({ ...current, protocol: { id, label } }));
    return () => set((current) => (current.protocol?.id === id ? { ...current, protocol: null } : current));
  }, [set, id, label]);
  return null;
}

/** Rendered by a page below a protocol tab to name itself in the top bar. */
export function CrumbLeaf({ label }: { label: string }) {
  const set = useContext(CrumbSetter);
  useEffect(() => {
    set((current) => ({ ...current, leaf: label }));
    return () => set((current) => (current.leaf === label ? { ...current, leaf: null } : current));
  }, [set, label]);
  return null;
}
