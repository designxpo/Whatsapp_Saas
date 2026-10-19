"use client";
// Client access to the workspace vocabulary. Renders neutral wording until the
// fetch lands (and if it fails), so a slow or broken lookup never blanks a label.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { GENERIC_VOCAB, type Vocab, type VocabKey } from "./vocab";

interface Ctx { vocab: Vocab; reload: () => void }
const VocabContext = createContext<Ctx>({ vocab: GENERIC_VOCAB, reload: () => {} });

export function VocabProvider({ children }: { children: ReactNode }) {
  const [vocab, setVocab] = useState<Vocab>(GENERIC_VOCAB);
  const reload = useCallback(() => {
    fetch("/api/admin/vocab").then(r => (r.ok ? r.json() : null)).then(d => { if (d?.vocab) setVocab(d.vocab as Vocab); }).catch(() => {});
  }, []);
  useEffect(reload, [reload]);
  const value = useMemo(() => ({ vocab, reload }), [vocab, reload]);
  return <VocabContext.Provider value={value}>{children}</VocabContext.Provider>;
}

/** `const { vocab, one, many } = useVocab(); many("contact") → "Students"`. */
export function useVocab() {
  const { vocab, reload } = useContext(VocabContext);
  const one = useCallback((k: VocabKey) => vocab[k].one, [vocab]);
  const many = useCallback((k: VocabKey) => vocab[k].many, [vocab]);
  return { vocab, one, many, reload };
}
