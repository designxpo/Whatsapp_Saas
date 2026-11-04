"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ImageIcon, Loader2, RefreshCw, Video, X } from "lucide-react";
import {
  MAX_CAMPAIGN_POSTS,
  type SocialPost,
  type SocialPostPage,
} from "@/lib/social-growth-policy";

type Props = {
  channelId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};
export function SocialPostPicker({
  channelId,
  value,
  onChange,
  disabled = false,
}: Props) {
  const [posts, setPosts] = useState<SocialPost[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  const request = useRef<AbortController | null>(null),
    generation = useRef(0);
  const load = useCallback(
    async (after: string | null = null) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const current = ++generation.current;
      setBusy(true);
      setError("");
      try {
        const query = new URLSearchParams({
          channelId,
          ...(after ? { after } : {}),
        });
        const response = await fetch(`/api/admin/social-posts?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json()) as SocialPostPage & {
          error?: string;
        };
        if (!response.ok || data.error)
          throw new Error(data.error || "Could not load posts");
        if (!Array.isArray(data.posts))
          throw new Error("Could not load posts. Refresh to try again.");
        if (current !== generation.current) return;
        setPosts((previous) => [
          ...new Map(
            [...(after ? previous : []), ...data.posts].map((post) => [
              post.id,
              post,
            ]),
          ).values(),
        ]);
        setNext(data.next || null);
      } catch (e) {
        if (current === generation.current && !controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Could not load posts");
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    [channelId],
  );
  useEffect(() => {
    if (channelId) void load();
    return () => {
      // Invalidate the latest request, not a DOM ref captured at mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      request.current?.abort();
    };
  }, [channelId, load]);
  const selected = new Set(value),
    visible = posts.filter((post) =>
      post.caption.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    );
  const missing = value.filter((id) => !posts.some((post) => post.id === id));
  function toggle(id: string) {
    if (selected.has(id)) onChange(value.filter((item) => item !== id));
    else if (value.length < MAX_CAMPAIGN_POSTS) onChange([...value, id]);
    else setError(`Select up to ${MAX_CAMPAIGN_POSTS} posts`);
  }
  if (!channelId)
    return (
      <p className="rounded-control border border-line bg-canvas p-3 text-xs text-ink-500">
        Choose a connected account to see its posts.
      </p>
    );
  return (
    <fieldset
      disabled={disabled}
      className="space-y-3 min-w-0"
      aria-label="Campaign posts"
    >
      <legend className="text-xs font-semibold text-ink-800">
        Choose posts
      </legend>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-control border border-line bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
            aria-hidden
          />
          Refresh posts
        </button>
      </div>
      <p className="text-xs text-ink-500">
        Select one or more posts from this account. Refresh fetches the latest
        posts; load more to browse older ones.
      </p>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search loaded captions…"
        aria-label="Search posts"
        className="w-full rounded-control border border-line bg-white px-3 py-2 text-xs"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span aria-live="polite">
          {value.length} selected · {posts.length} loaded
        </span>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="font-semibold text-brand-700"
          >
            Clear selection
          </button>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-control border border-red-200 bg-red-50 p-3 text-xs text-red-700"
        >
          {error}
        </p>
      )}
      {!busy && !error && !posts.length && (
        <p className="rounded-control border border-line bg-canvas p-3 text-xs text-ink-500">
          No published posts found for this account.
        </p>
      )}
      {posts.length > 0 && (
        <div
          className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto p-1 sm:grid-cols-3"
          aria-label="Published posts"
        >
          {visible.map((post) => (
            <div
              key={post.id}
              className={`min-w-0 overflow-hidden rounded-control border ${selected.has(post.id) ? "border-brand-600 ring-1 ring-brand-600" : "border-line"}`}
            >
              <button
                type="button"
                aria-pressed={selected.has(post.id)}
                aria-label={`Select post: ${post.caption || "Post without a caption"}`}
                onClick={() => toggle(post.id)}
                className="relative block w-full text-left"
              >
                <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-canvas">
                  <ImageIcon
                    className="absolute h-7 w-7 text-ink-300"
                    aria-hidden
                  />
                  {post.thumbnail && (
                    // Meta supplies expiring CDN thumbnails; load them directly, without proxying credentials.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.thumbnail}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(event) => {
                        event.currentTarget.style.visibility = "hidden";
                      }}
                      className="relative h-full w-full object-cover"
                    />
                  )}
                  {post.mediaType === "VIDEO" && (
                    <Video
                      className="absolute bottom-2 right-2 h-4 w-4 text-white drop-shadow"
                      aria-hidden
                    />
                  )}
                  <span
                    className={`absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border ${selected.has(post.id) ? "border-brand-600 bg-brand-600 text-white" : "border-white bg-white/90"}`}
                  >
                    {selected.has(post.id) && (
                      <Check className="h-3 w-3" aria-hidden />
                    )}
                  </span>
                </div>
                <div className="p-2">
                  <p className="line-clamp-2 min-h-8 break-words text-[11px] leading-4 text-ink-700">
                    {post.caption || "Post without a caption"}
                  </p>
                  <p className="mt-1 text-[10px] text-ink-400">
                    {post.timestamp &&
                    Number.isFinite(Date.parse(post.timestamp))
                      ? new Date(post.timestamp).toLocaleDateString()
                      : "Published post"}
                  </p>
                </div>
              </button>
              {post.permalink && (
                <a
                  href={post.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block border-t border-line px-2 py-1.5 text-[10px] font-semibold text-brand-700"
                >
                  View post ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      {posts.length > 0 && !visible.length && (
        <p className="text-xs text-ink-500">
          No loaded posts match that caption. Try another search or load more.
        </p>
      )}
      {missing.length > 0 && (
        <div className="rounded-control border border-line bg-canvas p-3 text-xs text-ink-500">
          <p>
            {missing.length} previously selected{" "}
            {missing.length === 1 ? "post is" : "posts are"} not in the loaded
            results. The selection is kept; load more to find older posts.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {missing.map((id, index) => (
              <button
                type="button"
                key={id}
                onClick={() => toggle(id)}
                aria-label={`Remove previously selected post ${index + 1}`}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-1"
              >
                Selected post {index + 1}
                <X size={11} aria-hidden />
              </button>
            ))}
          </div>
        </div>
      )}
      {busy && (
        <p
          role="status"
          className="flex items-center gap-2 text-xs text-ink-500"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading posts…
        </p>
      )}
      {next && (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void load(next)}
          className="w-full rounded-control border border-line bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
        >
          Load more posts
        </button>
      )}
      {value.length === 0 && (
        <p className="text-[11px] text-ink-500">
          Without a selected post, use a distinctive keyword to match enquiries
          across this account.
        </p>
      )}
    </fieldset>
  );
}
