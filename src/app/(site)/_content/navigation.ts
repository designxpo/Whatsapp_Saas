export type NavigationCard = { title: string; description: string; href: string; image: string; action: string };
export type NavigationGroup = { id: string; label: string; eyebrow: string; title: string; cards: NavigationCard[]; links: { label: string; href: string }[] };

export const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    id: "platform", label: "Platform", eyebrow: "THE TOOLS BEHIND THE CONVERSATION", title: "From the first hello to the next sale.",
    cards: [
      { title: "One connected inbox", description: "Bring customer chats, your team and AI together in one workspace.", href: "/features", image: "inbox", action: "Explore the platform" },
      { title: "Conversations that grow", description: "Turn comments into enquiries, qualify leads and keep the next step moving.", href: "/features#social-growth", image: "growth", action: "Explore growth workflows" },
      { title: "Your browser, connected", description: "Bring Talko AI into your daily workflow with the Chrome extension.", href: "/extension", image: "extension", action: "Meet the extension" },
    ],
    links: [{ label: "Compare plans", href: "/pricing" }, { label: "See what’s new", href: "/changelog" }],
  },
  {
    id: "solutions", label: "Solutions", eyebrow: "BUILT AROUND YOUR BUSINESS", title: "Different businesses. Better conversations.",
    cards: [
      { title: "Commerce & retail", description: "Help shoppers choose, answer product questions and follow up on carts.", href: "/industries/ecommerce", image: "commerce", action: "Explore commerce" },
      { title: "Education & coaching", description: "Guide course enquiries, capture the right details and nurture interest.", href: "/industries/edtech", image: "education", action: "Explore education" },
      { title: "Creators & communities", description: "Connect your content to resource delivery, workshops and new opportunities.", href: "/#for-creators", image: "creators", action: "Explore creator workflows" },
    ],
    links: [{ label: "All industries", href: "/industries" }, { label: "Find your setup", href: "/contact" }],
  },
  {
    id: "resources", label: "Resources", eyebrow: "A LITTLE KNOWLEDGE GOES A LONG WAY", title: "Find your next useful idea.",
    cards: [
      { title: "Guides & getting started", description: "Connect your channels and build your first useful automation.", href: "/guides", image: "guides", action: "Open the guides" },
      { title: "The Talko AI journal", description: "Practical playbooks on messaging, customer experience and growth.", href: "/blog", image: "journal", action: "Read the blog" },
      { title: "The people behind Talko AI", description: "Get to know the platform and the thinking behind every conversation.", href: "/about", image: "company", action: "Meet Talko AI" },
    ],
    links: [{ label: "Affiliate program", href: "/affiliate" }, { label: "Changelog", href: "/changelog" }, { label: "System status", href: "/status" }, { label: "Contact us", href: "/contact" }],
  },
];
