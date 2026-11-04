import Image from "next/image";
import { BLOG_ARTWORK } from "../_content/blog-artwork";

// Keep a title-card fallback for future posts until their artwork is commissioned.
export function BlogCoverImage({
  slug,
  title,
  priority = false,
  sizes,
  className = "",
}: {
  slug: string;
  title: string;
  priority?: boolean;
  sizes: string;
  className?: string;
}) {
  const artwork = BLOG_ARTWORK[slug];
  return (
    <Image
      src={artwork?.src ?? `/blog/${slug}/cover`}
      alt={artwork?.alt ?? title}
      fill
      sizes={sizes}
      priority={priority}
      className={`object-cover ${className}`}
    />
  );
}
