// "A peek inside Talko AI" — the polished product dashboard mockup as the
// showcase image for this section. (The dashboard lives in ./hero-dashboard.)
import { Container, SectionTitle } from "./ui";
import { Reveal } from "./motion";
import { TalkoDashboard } from "./hero-dashboard";

export function PlatformGlimpse() {
  return (
    <Container className="py-16">
      <SectionTitle eyebrow="A peek inside" title="See Talko AI in action" subtitle="One workspace for every conversation, campaign and number." />
      <Reveal className="mx-auto mt-12 max-w-5xl">
        <TalkoDashboard />
      </Reveal>
    </Container>
  );
}
