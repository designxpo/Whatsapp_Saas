// "A peek inside Talko AI" — an interactive tour of real product screens
// (public/tour) with a feature highlight for each. (Tour UI in ./product-tour.)
import { Container, SectionTitle } from "./ui";
import { Reveal } from "./motion";
import { ProductTour } from "./product-tour";

export function PlatformGlimpse() {
  return (
    <Container className="py-16">
      <SectionTitle eyebrow="A peek inside" title="See the whole platform"
        subtitle="Real screens from Talko AI — one workspace for every conversation, campaign and channel." />
      <Reveal className="mt-10"><ProductTour /></Reveal>
    </Container>
  );
}
