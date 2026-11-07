import { SiteChrome } from "../site-chrome";
import { FaqPreview } from "./faq-preview";
import { FinalCta } from "./final-cta";
import { Hero } from "./hero";
import { HowItWorks } from "./how-it-works";
import { Management } from "./management";
import { MultiBranch } from "./multi-branch";
import { OfflineSection } from "./offline";
import { OrderFlow } from "./order-flow";
import { PricingTeaser } from "./pricing-teaser";

export function LandingPage() {
  return (
    <SiteChrome>
      <Hero />
      <HowItWorks />
      <OrderFlow />
      <Management />
      <MultiBranch />
      <OfflineSection />
      <PricingTeaser />
      <FaqPreview />
      <FinalCta />
    </SiteChrome>
  );
}
