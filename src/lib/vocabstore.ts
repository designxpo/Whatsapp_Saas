// Workspace terminology follows an explicit Settings choice, then signup industry.
import { getTenant } from "./tenants";
import { getTenantSetting, setTenantSetting } from "./store";
import { GENERIC_VOCAB, industryPack, resolveVocab, sanitizeOverrides, vocabPromptNote, type Vocab, type VocabOverrides } from "./vocab";

export interface VocabState { industry: string; overrides: VocabOverrides; vocab: Vocab }

export async function getVocabState(tenantId: string): Promise<VocabState> {
  const [industry, rawOverrides] = await Promise.all([
    getTenantSetting<string | null>(tenantId, "vocab_industry", null),
    getTenantSetting<unknown>(tenantId, "vocab_overrides", {}),
  ]);
  const selected = industry ?? (await getTenant(tenantId))?.industry;
  const id = industryPack(selected).id;
  const overrides = sanitizeOverrides(rawOverrides);
  return { industry: id, overrides, vocab: resolveVocab(id, overrides) };
}

export const getVocab = async (tenantId: string): Promise<Vocab> => (await getVocabState(tenantId)).vocab;

// The AI reads the vocabulary on every reply, so keep it off the database hot
// path: a short per-process cache. A rename reaches the AI within the TTL.
const NOTE_TTL_MS = 60_000;
const noteCache = new Map<string, { at: number; note: string | null }>();
export async function getVocabPromptNote(tenantId: string): Promise<string | null> {
  const hit = noteCache.get(tenantId);
  if (hit && Date.now() - hit.at < NOTE_TTL_MS) return hit.note;
  const note = vocabPromptNote(await getVocab(tenantId).catch(() => GENERIC_VOCAB));
  noteCache.set(tenantId, { at: Date.now(), note });
  return note;
}
export const resetVocabNoteCache = () => noteCache.clear();

/** Pipeline columns for a workspace's industry; null → use the neutral default. */
export async function getIndustryStages(tenantId: string): Promise<string[] | null> {
  const { industry } = await getVocabState(tenantId);
  return industryPack(industry).stages ?? null;
}

export async function saveVocab(tenantId: string, input: { industry?: unknown; overrides?: unknown }): Promise<VocabState> {
  if (typeof input.industry === "string") await setTenantSetting(tenantId, "vocab_industry", industryPack(input.industry).id);
  if (input.overrides !== undefined) await setTenantSetting(tenantId, "vocab_overrides", sanitizeOverrides(input.overrides));
  noteCache.delete(tenantId);
  return getVocabState(tenantId);
}
