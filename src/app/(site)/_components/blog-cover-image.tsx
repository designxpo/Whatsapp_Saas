import Image from "next/image";
import { BLOG_ARTWORK } from "../_content/blog-artwork";

// Keep a title-card fallback for future posts until their artwork is commissioned.
export function BlogCoverImage({
  slug,
  title,
  priority = false,
  sizes,
  className = "",
  preview,
}: {
  slug: string;
  title: string;
  priority?: boolean;
  sizes: string;
  className?: string;
  /** A signed preview token: the generated cover of an unpublished article is private too. */
  preview?: string | null;
}) {
  const artwork = BLOG_ARTWORK[slug];
  const generated = `/blog/${slug}/cover${preview && !artwork ? `?preview=${encodeURIComponent(preview)}` : ""}`;
  return (
    <Image
      src={artwork?.src ?? generated}
      // A preview cover carries its token in the query string; serve it as-is.
      unoptimized={!!preview && !artwork}
      alt={artwork?.alt ?? title}
      fill
      sizes={sizes}
      priority={priority}
      className={`object-cover ${className}`}
    />
  );
}
