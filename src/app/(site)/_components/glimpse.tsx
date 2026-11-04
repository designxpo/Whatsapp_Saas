// "A peek inside Talko AI" — an interactive tour of real product screens
// (public/tour) with a feature highlight for each. (Tour UI in ./product-tour.)
import { Container, SectionTitle } from "./ui";
import { Reveal } from "./motion";
import { ProductTour } from "./product-tour";

export function PlatformGlimpse() {
  return (
    <section id="platform-explorer" aria-label="Explore the Talko AI platform">
      <Container className="py-16">
        <SectionTitle
          eyebrow="A peek inside"
          title="Every part of your customer journey"
          subtitle="Explore the inbox, review replies, follow-ups, campaigns and commerce that work together in Talko AI."
        />
        <Reveal className="mt-10">
          <ProductTour />
        </Reveal>
      </Container>
    </section>
  );
}
