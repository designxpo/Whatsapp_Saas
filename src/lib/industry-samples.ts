// Sample content uses the same domain resolver as workspace terminology.
import { industryPack } from "./vocab";

export interface ReviewSample { rating: number; text: string }
const REVIEW_TEXT: Record<string, [string, string, string, string]> = {
  generic: ["The team was helpful and everything went smoothly. Thank you!", "Good service but I was charged twice on my card, please refund.", "The service was useful, though the staff were rude when I asked for help.", "Waited 40 minutes and still did not receive the service I booked."],
  creator: ["The workshop was practical and the resources helped me get started!", "Loved the resource but I was charged twice for my membership, please refund.", "The session was useful, though the team were rude when I asked for help.", "My booked coaching session never happened and nobody has replied."],
  restaurant: ["Loved the food and the staff were so welcoming. Will visit again!", "Great meal but I was charged twice on my card, please refund.", "Nice cafe, though the staff were rude when I asked about the menu.", "Waited 40 minutes for a table that was booked."],
  ecommerce: ["My order arrived on time and the product quality was excellent!", "Great product but I was charged twice on my card, please refund.", "The product is useful, though the support staff were rude when I asked about delivery.", "My order is still missing and nobody has replied to my delivery enquiry."],
  saas: ["The platform is easy to use and the support team helped us get started!", "Great software but I was charged twice for my subscription, please refund.", "The platform is useful, though the support agent was rude when I asked for help.", "Our account has been inaccessible for two days and support has not replied."],
  education: ["The course was clear and the counsellor helped me choose the right programme!", "Great course but I was charged twice for tuition, please refund.", "The classes were useful, though the counsellor was rude when I asked about admissions.", "My booked counselling session never happened and nobody has followed up."],
  healthcare: ["The care team explained everything clearly and my appointment went smoothly!", "The appointment went well but I was charged twice, please refund.", "The consultation was helpful, though the care coordinator was rude when I asked for help.", "Waited 40 minutes past my appointment time without an update."],
  realestate: ["The agent answered all my questions and arranged a helpful site visit!", "The site visit went well but I was charged twice for the booking, please refund.", "The property looked good, though the agent was rude when I asked about the documents.", "Nobody arrived for my booked site visit and my calls went unanswered."],
  travel: ["Our stay was comfortable and the travel advisor organised everything well!", "Great trip but I was charged twice for my reservation, please refund.", "The package was good, though the travel advisor was rude when I asked for help.", "Our confirmed reservation was unavailable when we arrived."],
  finance: ["The advisor explained the plan clearly and made onboarding straightforward!", "The consultation was helpful but I was charged twice, please refund.", "The plan was explained clearly, though the advisor was rude when I asked about fees.", "My booked consultation never happened and nobody has returned my calls."],
  agency: ["The team understood our brief and delivered the campaign on time!", "Great campaign but I was charged twice on the invoice, please refund.", "The work was good, though the account manager was rude when I asked for changes.", "Our agreed deadline passed and nobody has shared a project update."],
};

export function reviewSamples(industry: string | null | undefined): ReviewSample[] {
  const texts = REVIEW_TEXT[industryPack(industry).id] ?? REVIEW_TEXT.generic;
  return texts.map((text, i) => ({ rating: [5, 5, 4, 2][i], text }));
}
