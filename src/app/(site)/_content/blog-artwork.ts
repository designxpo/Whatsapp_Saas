// Generated editorial artwork, kept separate from article copy and SEO metadata.
export const BLOG_ARTWORK: Record<string, { src: string; alt: string }> = {
  "ai-customer-service-vs-human-support": {
    src: "/blog/ai-customer-service-vs-human-support.webp",
    alt: "A support professional with a headset beside a phone showing connected AI and human conversation symbols.",
  },
  "whatsapp-quality-rating-red-flagged-restricted": {
    src: "/blog/whatsapp-quality-rating-red-flagged-restricted.webp",
    alt: "A phone with messaging account status indicators for quality warnings and restrictions.",
  },
  "whatsapp-template-rejected": {
    src: "/blog/whatsapp-template-rejected.webp",
    alt: "A message draft being corrected from a rejected template to an approved one.",
  },
  "whatsapp-service-message-pricing-october-2026": {
    src: "/blog/whatsapp-service-message-pricing-october-2026.webp",
    alt: "A smartphone, calculator and invoice representing business messaging costs.",
  },
  "comment-to-dm-automation": {
    src: "/blog/comment-to-dm-automation.webp",
    alt: "A public comment connected to a private message on a smartphone.",
  },
  "automate-google-review-replies": {
    src: "/blog/automate-google-review-replies.webp",
    alt: "A five-star customer review paired with a thoughtful reply.",
  },
  "whatsapp-automation-guide": {
    src: "/blog/whatsapp-automation-guide.webp",
    alt: "A business owner connecting customer messages to an automated response workflow.",
  },
  "bring-your-own-ai-key": {
    src: "/blog/bring-your-own-ai-key.webp",
    alt: "A physical key beside a laptop representing control over AI access.",
  },
  "instagram-dm-best-practices": {
    src: "/blog/instagram-dm-best-practices.webp",
    alt: "A creator using private messages with a protective shield symbol.",
  },
  "holiday-customer-support-whatsapp-instagram-ai-inbox": {
    src: "/blog/holiday-customer-support-whatsapp-instagram-ai-inbox.webp",
    alt: "A holiday support desk with a shared inbox, business messaging phone and human support adviser.",
  },
  "choose-whatsapp-automation-platform-checklist": {
    src: "/blog/choose-whatsapp-automation-platform-checklist.webp",
    alt: "A vendor evaluation board with checklist cards and software options for a business buyer.",
  },
  "whatsapp-business-app-vs-api-growing-teams": {
    src: "/blog/whatsapp-business-app-vs-api-growing-teams.webp",
    alt: "A single business phone connected to a coordinated team inbox as a company grows.",
  },
  "click-to-whatsapp-ads-qualified-leads": {
    src: "/blog/click-to-whatsapp-ads-qualified-leads.webp",
    alt: "An advertising creative connected to a messaging conversation and qualified lead cards.",
  },
  "whatsapp-lead-qualification-chatbot-scripts": {
    src: "/blog/whatsapp-lead-qualification-chatbot-scripts.webp",
    alt: "Chat questions moving through a decision tree to an organised customer profile.",
  },
  "black-friday-whatsapp-cart-recovery-workflow": {
    src: "/blog/black-friday-whatsapp-cart-recovery-workflow.webp",
    alt: "A shopping cart with gift boxes guided towards checkout by a helpful messaging conversation.",
  },
  "holiday-customer-support-ai-human-handoff": {
    src: "/blog/holiday-customer-support-ai-human-handoff.webp",
    alt: "An AI conversation handed to a human support adviser with its conversation history.",
  },
  "whatsapp-automation-total-cost-international-teams": {
    src: "/blog/whatsapp-automation-total-cost-international-teams.webp",
    alt: "A globe, calculator and separate cost cards representing international messaging budgets.",
  },
  "instagram-whatsapp-follow-up-without-duplicate-messages": {
    src: "/blog/instagram-whatsapp-follow-up-without-duplicate-messages.webp",
    alt: "Two messaging phones connected to one customer record and a single follow-up action.",
  },
  "instagram-holiday-campaign-comments-to-qualified-leads": {
    src: "/blog/instagram-holiday-campaign-comments-to-qualified-leads.webp",
    alt: "Seasonal social posts connected through comment bubbles to a private chat and a lead card.",
  },
  "holiday-cart-recovery-whatsapp-catalog-follow-up": {
    src: "/blog/holiday-cart-recovery-whatsapp-catalog-follow-up.webp",
    alt: "A product catalog, shopping cart and checkout card linked by a helpful chat.",
  },
  "after-hours-website-chat-international-lead-capture": {
    src: "/blog/after-hours-website-chat-international-lead-capture.webp",
    alt: "A website chat widget in a nighttime office connected to international enquiries around a globe.",
  },
  "holiday-returns-complaints-google-review-case-management": {
    src: "/blog/holiday-returns-complaints-google-review-case-management.webp",
    alt: "A returned parcel and service case board with separate public review and private support cards.",
  },
  "google-review-requests-qr-codes-after-customer-visit": {
    src: "/blog/google-review-requests-qr-codes-after-customer-visit.webp",
    alt: "A cafe counter with a review invitation card and a phone ready for honest customer feedback.",
  },
  "january-enquiry-pipeline-ai-qualification-follow-ups": {
    src: "/blog/january-enquiry-pipeline-ai-qualification-follow-ups.webp",
    alt: "A planning calendar, lead pipeline and assigned follow-up cards for a new-year sales campaign.",
  },
  "multi-location-google-reviews-language-reply-presets": {
    src: "/blog/multi-location-google-reviews-language-reply-presets.webp",
    alt: "Multiple storefronts linked to review cards, language choices and a central management view.",
  },
  "youtube-comment-automation-product-questions-qualified-enquiries": {
    src: "/blog/youtube-comment-automation-product-questions-qualified-enquiries.webp",
    alt: "A product video connected to a helpful comment reply, moderation and a customer enquiry.",
  },
  "whatsapp-automation-agencies-client-onboarding": {
    src: "/blog/whatsapp-automation-agencies-client-onboarding.webp",
    alt: "Agency consultants organising separate client workspaces, access keys and onboarding checklists.",
  },
  "whatsapp-automation-roi-30-day-pilot": {
    src: "/blog/whatsapp-automation-roi-30-day-pilot.webp",
    alt: "An analyst reviewing a four-stage automation pilot with outcome cards and separate cost measures.",
  },
};

/** One image choice for article cards, Open Graph, Twitter and structured data. */
export function blogShareImage(post: { slug: string; shareImage?: string }): string {
  return post.shareImage ?? BLOG_ARTWORK[post.slug]?.src ?? `/blog/${post.slug}/cover`;
}
