import { getChannel } from "./channels";
import type { SocialPost, SocialPostPage } from "./social-growth-policy";

export class SocialPostError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const string = (value: unknown) => (typeof value === "string" ? value : "");
const publicUrl = (value: unknown) => {
  try {
    const url = new URL(string(value));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
};

/** Read only the explicitly selected workspace/account. Never follow Graph's next URL. */
export async function listSocialPosts(
  tenantId: string,
  channelId: string,
  after: string | null = null,
): Promise<SocialPostPage> {
  if (!channelId || channelId.length > 80)
    throw new SocialPostError("Select a connected account");
  if (after && after.length > 4096)
    throw new SocialPostError("Invalid post cursor. Refresh the posts.");
  const channel = await getChannel(channelId, tenantId);
  if (!channel || !["instagram", "messenger"].includes(channel.kind))
    throw new SocialPostError(
      "Connected account not found in this workspace",
      404,
    );
  if (!channel.active || !channel.token)
    throw new SocialPostError("Reconnect this account to load its posts", 409);
  const instagram = channel.kind === "instagram";
  const account = instagram ? channel.igUserId : channel.pageId;
  if (!account)
    throw new SocialPostError("Reconnect this account to load its posts", 409);
  const host = instagram
    ? process.env.META_IG_GRAPH_HOST || "graph.instagram.com"
    : "graph.facebook.com";
  const fields = instagram
    ? "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp"
    : "id,message,full_picture,permalink_url,created_time";
  const query = new URLSearchParams({
    fields,
    limit: "25",
    ...(after ? { after } : {}),
  });
  let response: Response;
  let json: {
    data?: Record<string, unknown>[];
    error?: { message?: string };
    paging?: { next?: string; cursors?: { after?: string } };
  };
  try {
    response = await fetch(
      `https://${host}/${process.env.META_GRAPH_VERSION || "v22.0"}/${encodeURIComponent(account)}/${instagram ? "media" : "published_posts"}?${query}`,
      {
        headers: { Authorization: `Bearer ${channel.token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    json = await response.json();
  } catch {
    throw new SocialPostError(
      "Could not reach the account. Refresh the posts to try again.",
      502,
    );
  }
  if (!json || typeof json !== "object")
    throw new SocialPostError(
      "The account returned an invalid post list. Refresh to try again.",
      502,
    );
  if (!response.ok || json.error)
    throw new SocialPostError(
      "Could not load posts from this account. Check its connection and post-reading permissions, then refresh.",
      502,
    );
  if (!Array.isArray(json.data))
    throw new SocialPostError(
      "The account returned an invalid post list. Refresh to try again.",
      502,
    );
  const posts: SocialPost[] = json.data
    .filter((item) => typeof item.id === "string" && item.id.length > 0)
    .map((item) => ({
      id: string(item.id),
      caption: string(instagram ? item.caption : item.message),
      permalink: publicUrl(instagram ? item.permalink : item.permalink_url),
      thumbnail: publicUrl(
        instagram
          ? item.thumbnail_url ||
              (item.media_type === "VIDEO" ? "" : item.media_url)
          : item.full_picture,
      ),
      mediaType: instagram ? string(item.media_type) : "POST",
      timestamp: string(instagram ? item.timestamp : item.created_time),
    }));
  const cursor = json.paging?.next ? json.paging.cursors?.after : null;
  return {
    posts,
    next:
      typeof cursor === "string" && cursor !== after && cursor.length <= 4096
        ? cursor
        : null,
  };
}
