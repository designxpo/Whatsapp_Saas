// Renders a JSON-LD structured-data block. Server component — the object is
// serialized at build/render time; nothing ships to the client beyond the
// static <script>. Used for Organization, WebSite, FAQPage, SoftwareApplication
// and BlogPosting schema so search engines and AI answer engines can extract
// clean, quotable facts about Talko AI.
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // Content is our own static data, not user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
