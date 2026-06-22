// Legal content for Talko AI — single source of truth for all policy documents
// (Terms, Privacy, Acceptable Use, Refunds, Cookies). Pure data, no JSX, usable
// from server components and the sitemap.
//
// EDIT ME: the placeholders in LEGAL_META (legal entity, contact emails,
// jurisdiction) should be replaced with your real registered details, and these
// documents should be reviewed by counsel before relying on them.

// Version stamp recorded against each signup's consent + shown as the effective
// date. Bump LEGAL_VERSION whenever the substance of a document changes so we can
// tell which version a user agreed to.
export const LEGAL_VERSION = "2026-06-22";
export const LEGAL_EFFECTIVE = "22 June 2026";

export const LEGAL_META = {
  company: "Talko AI",
  // Replace with your registered legal entity (e.g. "Talko AI Technologies Pvt. Ltd.").
  legalEntity: "Talko AI",
  contactEmail: "support@talko.ai",
  privacyEmail: "privacy@talko.ai",
  // Replace with your place of business / registered office.
  jurisdiction: "Bengaluru, Karnataka, India",
  governingLaw: "India",
};

const C = LEGAL_META.company;
const CONTACT = LEGAL_META.contactEmail;
const PRIVACY = LEGAL_META.privacyEmail;

export type LegalBlock = { type: "p"; text: string } | { type: "list"; items: string[] };
export type LegalSection = { heading: string; blocks: LegalBlock[] };
export type LegalDoc = { slug: string; title: string; summary: string; sections: LegalSection[] };

const p = (text: string): LegalBlock => ({ type: "p", text });
const ul = (items: string[]): LegalBlock => ({ type: "list", items });

const TERMS: LegalDoc = {
  slug: "terms",
  title: "Terms of Service",
  summary: `The agreement between you and ${C} for your use of the platform.`,
  sections: [
    { heading: "1. Agreement to these terms", blocks: [
      p(`These Terms of Service ("Terms") govern your access to and use of the ${C} platform, websites, applications and related services (together, the "Service"), operated by ${LEGAL_META.legalEntity} ("${C}", "we", "us" or "our").`),
      p(`By creating an account, ticking the acceptance box at sign-up, or otherwise accessing or using the Service, you agree to be bound by these Terms and by our Privacy Policy, Acceptable Use Policy, Refund & Cancellation Policy and Cookie Policy, which are incorporated here by reference. If you do not agree, you must not use the Service.`),
      p(`If you are entering into these Terms on behalf of a company or other organisation, you represent that you have the authority to bind that organisation, and "you" refers to that organisation.`),
    ] },
    { heading: "2. The Service", blocks: [
      p(`${C} is a multi-channel conversational platform that lets businesses connect WhatsApp, Instagram, Facebook Messenger and a website web-chat widget, automate replies with AI, run broadcasts, build chatbot flows and drip sequences, and manage conversations from a unified inbox.`),
      p(`The Service connects to third-party platforms (such as Meta's WhatsApp, Instagram and Messenger APIs) and to AI providers using credentials and API keys that you supply. Your use of those platforms remains subject to their own terms and policies.`),
    ] },
    { heading: "3. Eligibility and accounts", blocks: [
      p(`You must be at least 18 years old and capable of forming a binding contract to use the Service. You are responsible for the accuracy of the information you provide and for keeping it up to date.`),
      p(`You are responsible for safeguarding your account credentials and for all activity that occurs under your account. You must notify us promptly at ${CONTACT} of any unauthorised use. Each business account is isolated from others; you may invite team members subject to the seat limits of your plan.`),
    ] },
    { heading: "4. Free trial", blocks: [
      p(`We may offer a free trial period (typically 14 days). At the end of the trial, continued use of paid features requires an active paid plan. We may modify or discontinue trials at any time. Trial accounts are subject to the same Acceptable Use Policy as paid accounts.`),
    ] },
    { heading: "5. Plans, billing and taxes", blocks: [
      p(`Paid plans are billed in advance on a recurring (monthly or other stated) basis until cancelled. By subscribing you authorise us, or our payment processor, to charge the applicable fees and any taxes to your chosen payment method on each renewal date.`),
      p(`Prices are stated exclusive of taxes unless otherwise indicated; you are responsible for all applicable taxes. We may change plan pricing or features on reasonable notice; changes take effect at your next renewal. AI usage is billed directly to your own AI provider under the "bring your own key" model and is not charged by us.`),
      p(`Refunds and cancellations are governed by our Refund & Cancellation Policy.`),
    ] },
    { heading: "6. Acceptable use", blocks: [
      p(`Your use of the Service must comply at all times with our Acceptable Use Policy, including all messaging-platform rules around consent, opt-in, messaging windows and prohibited content. We may suspend or limit messaging that puts your connected accounts or our infrastructure at risk.`),
    ] },
    { heading: "7. Your content and data", blocks: [
      p(`You retain all rights to the content, contacts, messages and other data you submit to or generate through the Service ("Your Data"). You grant us a limited licence to host, process and transmit Your Data solely to provide and improve the Service and as described in our Privacy Policy.`),
      p(`You are responsible for Your Data and for having all necessary rights, consents and lawful bases to collect and process it, including the consent of the end-customers you message. With respect to personal data of your end-customers, you act as the data controller and ${C} acts as your processor.`),
    ] },
    { heading: "8. Third-party services", blocks: [
      p(`The Service integrates with third-party services including Meta (WhatsApp, Instagram, Messenger), payment processors, AI model providers and other tools you choose to connect. We are not responsible for third-party services, their availability, or changes to their APIs or policies, which may affect the Service. Your use of those services is governed by their own terms.`),
    ] },
    { heading: "9. Intellectual property", blocks: [
      p(`The Service, including its software, design, trademarks and content (excluding Your Data), is owned by ${C} or its licensors and is protected by intellectual-property laws. We grant you a limited, non-exclusive, non-transferable, revocable licence to use the Service for your internal business purposes during your subscription. You may not copy, modify, resell, reverse-engineer or create derivative works of the Service except as permitted by law.`),
      p(`If you provide feedback or suggestions, you grant us a perpetual, royalty-free licence to use them without restriction.`),
    ] },
    { heading: "10. Confidentiality", blocks: [
      p(`Each party may have access to the other's confidential information. Each party agrees to protect the other's confidential information with reasonable care and to use it only as needed to perform under these Terms.`),
    ] },
    { heading: "11. Availability and changes to the Service", blocks: [
      p(`We aim to keep the Service available but do not guarantee uninterrupted or error-free operation. We may modify, suspend or discontinue features, perform maintenance, or impose usage limits to protect the integrity and security of the Service. We will use reasonable efforts to give notice of material adverse changes.`),
    ] },
    { heading: "12. Disclaimers", blocks: [
      p(`The Service is provided "as is" and "as available" without warranties of any kind, whether express, implied or statutory, including warranties of merchantability, fitness for a particular purpose and non-infringement. We do not warrant that AI-generated responses will be accurate, complete or suitable for any purpose, or that messaging through third-party platforms will always be delivered. You are responsible for reviewing automated outputs before relying on them.`),
    ] },
    { heading: "13. Limitation of liability", blocks: [
      p(`To the maximum extent permitted by law, ${C} and its affiliates will not be liable for any indirect, incidental, special, consequential or punitive damages, or any loss of profits, revenue, data or goodwill, arising out of or relating to the Service.`),
      p(`Our total aggregate liability for any claim arising out of or relating to the Service will not exceed the total fees you paid to us for the Service in the three (3) months immediately preceding the event giving rise to the claim.`),
    ] },
    { heading: "14. Indemnification", blocks: [
      p(`You agree to indemnify and hold ${C} harmless from any claims, damages, liabilities and expenses (including reasonable legal fees) arising from Your Data, your use of the Service, your violation of these Terms or the Acceptable Use Policy, or your infringement of any third-party or messaging-platform rights.`),
    ] },
    { heading: "15. Suspension and termination", blocks: [
      p(`You may cancel your subscription at any time as described in the Refund & Cancellation Policy. We may suspend or terminate your access if you breach these Terms or the Acceptable Use Policy, fail to pay fees, or if required to protect the Service, other users or third parties.`),
      p(`On termination, your right to use the Service ends. We will make Your Data available for export for a reasonable period and may then delete it in accordance with our Privacy Policy. Sections that by their nature should survive termination (including ownership, disclaimers, liability limits and indemnity) will survive.`),
    ] },
    { heading: "16. Governing law and disputes", blocks: [
      p(`These Terms are governed by the laws of ${LEGAL_META.governingLaw}, without regard to conflict-of-laws principles. You agree to the exclusive jurisdiction of the courts located in ${LEGAL_META.jurisdiction} for any dispute arising out of or relating to these Terms or the Service, subject to any mandatory consumer-protection rights you may have.`),
    ] },
    { heading: "17. Changes to these Terms", blocks: [
      p(`We may update these Terms from time to time. If we make material changes, we will provide notice (for example, by email or in-product). Your continued use of the Service after changes take effect constitutes acceptance of the revised Terms. The "last updated" date below indicates the current version.`),
    ] },
    { heading: "18. Contact", blocks: [
      p(`Questions about these Terms can be sent to ${CONTACT}.`),
    ] },
  ],
};

const PRIVACY_DOC: LegalDoc = {
  slug: "privacy",
  title: "Privacy Policy",
  summary: `How ${C} collects, uses, shares and protects personal information.`,
  sections: [
    { heading: "1. Overview", blocks: [
      p(`This Privacy Policy explains how ${LEGAL_META.legalEntity} ("${C}", "we", "us") collects, uses, discloses and safeguards personal information when you use our website and platform (the "Service"). By using the Service you agree to the practices described here.`),
    ] },
    { heading: "2. Our role: controller and processor", blocks: [
      p(`For information about your own account and use of the Service (such as your name, email and billing details), ${C} acts as the data controller.`),
      p(`For the personal data of your end-customers that flows through the Service — the contacts and conversations on your connected WhatsApp, Instagram, Messenger and web-chat channels — you are the data controller and ${C} acts as your data processor, processing that data on your instructions to provide the Service.`),
    ] },
    { heading: "3. Information we collect", blocks: [
      ul([
        "Account information: name, business name, email, phone, password (stored hashed), and the industry, team size and use-case details you provide at sign-up.",
        "Billing information: plan, subscription status and payment metadata. Card details are handled by our payment processor and are not stored by us.",
        "Channel & integration data: the credentials and API keys you connect (encrypted at rest), and the messages, contacts and media exchanged on your connected channels.",
        "AI keys: the AI provider keys you supply, stored encrypted and used only to generate replies for your account.",
        "Usage data: log data, device and browser information, IP address, feature usage and diagnostic information.",
        "Cookies and similar technologies, as described in our Cookie Policy.",
      ]),
    ] },
    { heading: "4. How we use information", blocks: [
      ul([
        "To provide, operate, secure and improve the Service.",
        "To authenticate users, manage accounts and process billing.",
        "To generate AI responses using the keys and knowledge base you provide.",
        "To send service, security and transactional communications, and — where permitted — product updates you can opt out of.",
        "To detect, prevent and address fraud, abuse and security or technical issues.",
        "To comply with legal obligations and enforce our terms.",
      ]),
    ] },
    { heading: "5. Legal bases for processing", blocks: [
      p(`Where applicable law requires a legal basis, we rely on: performance of our contract with you; our legitimate interests in operating and securing the Service; your consent (which you may withdraw); and compliance with legal obligations.`),
    ] },
    { heading: "6. How we share information", blocks: [
      p(`We do not sell personal information. We share information only as needed to run the Service, with sub-processors and partners that are bound by appropriate confidentiality and data-protection obligations, including:`),
      ul([
        "Meta Platforms — to send and receive messages on WhatsApp, Instagram and Messenger.",
        "AI providers you choose (such as Google Gemini, OpenAI or Anthropic) — to generate replies using your key.",
        "Payment processors (such as Stripe or Razorpay) — to handle subscriptions and payments.",
        "Infrastructure and hosting providers (such as our cloud database and hosting platform) — to store and serve data.",
        "Professional advisers, and authorities where required by law or to protect rights and safety.",
      ]),
      p(`We may also disclose information in connection with a merger, acquisition or sale of assets, subject to this Policy.`),
    ] },
    { heading: "7. International transfers", blocks: [
      p(`Your information may be processed in countries other than your own. Where we transfer personal data internationally, we use appropriate safeguards, such as standard contractual clauses, where required by applicable law.`),
    ] },
    { heading: "8. Data retention", blocks: [
      p(`We retain personal information for as long as your account is active or as needed to provide the Service, and thereafter only as required to comply with legal obligations, resolve disputes and enforce agreements. You can request export or deletion of Your Data; on account termination we delete or anonymise data within a reasonable period, subject to legal retention requirements.`),
    ] },
    { heading: "9. Security", blocks: [
      p(`We use technical and organisational measures designed to protect personal information, including encryption of credentials and API keys at rest, per-business data isolation with row-level security, access controls and audit logging. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.`),
    ] },
    { heading: "10. Your rights", blocks: [
      p(`Depending on your location, you may have rights to access, correct, delete, export or restrict the processing of your personal data, and to object to processing or withdraw consent. To exercise these rights, contact ${PRIVACY}. Where ${C} acts as a processor for end-customer data, requests from those individuals should be directed to the business that controls that data.`),
    ] },
    { heading: "11. Cookies", blocks: [
      p(`We use cookies and similar technologies as described in our Cookie Policy.`),
    ] },
    { heading: "12. Children", blocks: [
      p(`The Service is not directed to children under 16, and we do not knowingly collect their personal information. If you believe a child has provided us personal data, contact us and we will delete it.`),
    ] },
    { heading: "13. Changes to this Policy", blocks: [
      p(`We may update this Privacy Policy from time to time. Material changes will be notified through the Service or by email, and the "last updated" date below will reflect the current version.`),
    ] },
    { heading: "14. Contact", blocks: [
      p(`For privacy questions or to exercise your rights, contact us at ${PRIVACY}.`),
    ] },
  ],
};

const ACCEPTABLE_USE: LegalDoc = {
  slug: "acceptable-use",
  title: "Acceptable Use Policy",
  summary: `The rules that keep messaging compliant and your connected accounts safe.`,
  sections: [
    { heading: "1. Purpose", blocks: [
      p(`This Acceptable Use Policy ("AUP") sets out what is and isn't allowed when using ${C}. It protects you, your customers, the messaging platforms we connect to, and our infrastructure. Breaching this AUP may result in suspension or termination.`),
    ] },
    { heading: "2. Messaging consent and compliance", blocks: [
      p(`You must only message people who have given you the necessary consent and must honour all rules of the underlying messaging platforms. In particular, you agree to:`),
      ul([
        "Obtain valid opt-in before messaging contacts, and keep records of that consent.",
        "Respect messaging windows (such as the WhatsApp and Instagram 24-hour customer-service windows) and use approved templates where required.",
        "Honour opt-out and unsubscribe requests promptly.",
        "Not send unsolicited bulk messages, cold outreach, or spam.",
      ]),
    ] },
    { heading: "3. Prohibited content and activities", blocks: [
      p(`You must not use the Service to send, store or promote content that:`),
      ul([
        "Is unlawful, fraudulent, deceptive, harassing, defamatory, hateful or violent.",
        "Infringes intellectual-property, privacy or other rights of others.",
        "Promotes illegal goods or services, or content prohibited by the connected platforms (for example certain regulated, adult or dangerous categories).",
        "Contains malware, phishing or attempts to harvest credentials.",
        "Misrepresents your identity or your relationship with any person or brand.",
      ]),
    ] },
    { heading: "4. Platform policy compliance", blocks: [
      p(`Your connected channels remain subject to the policies of their providers, including the WhatsApp Business Messaging Policy, the WhatsApp Commerce Policy, and Meta's Instagram and Messenger platform policies. You are responsible for complying with those policies. Violations can lead the providers to restrict or ban your numbers, accounts or Pages, for which ${C} is not responsible.`),
    ] },
    { heading: "5. System integrity", blocks: [
      p(`You must not:`),
      ul([
        "Attempt to gain unauthorised access to the Service, other accounts or our systems.",
        "Probe, scan or test the vulnerability of the Service, or breach security or authentication measures.",
        "Interfere with or disrupt the Service, for example through excessive automated requests or denial-of-service activity.",
        "Reverse-engineer, scrape or resell the Service except as permitted by law.",
      ]),
    ] },
    { heading: "6. AI usage", blocks: [
      p(`When using AI features you remain responsible for the outputs you send. You must not use the Service to generate or distribute content that violates this AUP, and you should review automated responses where accuracy matters. You are responsible for complying with the terms of the AI provider whose key you connect.`),
    ] },
    { heading: "7. Enforcement", blocks: [
      p(`We may investigate suspected violations and may remove content, throttle or suspend messaging, or suspend or terminate accounts to protect the Service, other users or third parties. Where practical we will give notice, but we may act immediately for serious or ongoing violations or where required by a platform provider or law.`),
    ] },
    { heading: "8. Reporting", blocks: [
      p(`To report a violation of this AUP, contact us at ${CONTACT}.`),
    ] },
  ],
};

const REFUND: LegalDoc = {
  slug: "refund",
  title: "Refund & Cancellation Policy",
  summary: `How trials, billing, cancellations and refunds work.`,
  sections: [
    { heading: "1. Free trial", blocks: [
      p(`New accounts may start with a free trial (typically 14 days), with no charge during the trial. You can cancel any time during the trial without being billed. If you do not subscribe to a paid plan, paid features become unavailable when the trial ends.`),
    ] },
    { heading: "2. Subscription billing", blocks: [
      p(`Paid plans are billed in advance on a recurring basis (for example monthly). Your subscription renews automatically at the start of each billing period until you cancel. The applicable fees plus any taxes are charged to your payment method on each renewal date.`),
    ] },
    { heading: "3. Cancellation", blocks: [
      p(`You can cancel your subscription at any time from the billing area of your account, or by contacting ${CONTACT}. Cancellation stops future renewals; your plan remains active until the end of the current paid period, after which it will not renew.`),
    ] },
    { heading: "4. Refunds", blocks: [
      p(`Except where required by law, fees already paid are non-refundable and we do not provide refunds or credits for partial billing periods, unused time, or features not used. If you believe you have been billed in error, contact us at ${CONTACT} within 7 days of the charge and we will review the issue in good faith.`),
    ] },
    { heading: "5. Plan changes", blocks: [
      p(`You can upgrade or downgrade where available. Upgrades take effect immediately and may be charged on a pro-rated basis; downgrades typically take effect at the next renewal. Some features and limits change with your plan.`),
    ] },
    { heading: "6. Failed payments", blocks: [
      p(`If a renewal payment fails, we may retry the charge and may suspend or downgrade access until payment succeeds. Accounts left unpaid may be cancelled.`),
    ] },
    { heading: "7. Contact", blocks: [
      p(`For any billing question, contact ${CONTACT}.`),
    ] },
  ],
};

const COOKIES: LegalDoc = {
  slug: "cookies",
  title: "Cookie Policy",
  summary: `The cookies and similar technologies we use, and how to manage them.`,
  sections: [
    { heading: "1. What are cookies", blocks: [
      p(`Cookies are small text files stored on your device when you visit a website. We use cookies and similar technologies (such as local storage) to operate and improve the Service.`),
    ] },
    { heading: "2. How we use cookies", blocks: [
      ul([
        "Essential cookies — required to sign you in, keep you authenticated and maintain your session. The Service does not work without these.",
        "Preference cookies — remember choices such as interface settings.",
        "Analytics — where used, to understand aggregate usage so we can improve the Service. These do not identify you personally.",
      ]),
    ] },
    { heading: "3. Managing cookies", blocks: [
      p(`Most browsers let you block or delete cookies through their settings. Blocking essential cookies will prevent you from signing in and using core features. Where required, we will ask for your consent before setting non-essential cookies.`),
    ] },
    { heading: "4. Contact", blocks: [
      p(`Questions about our use of cookies can be sent to ${PRIVACY}.`),
    ] },
  ],
};

export const LEGAL_DOCS: LegalDoc[] = [TERMS, PRIVACY_DOC, ACCEPTABLE_USE, REFUND, COOKIES];

// Footer / nav order (slug → short label).
export const LEGAL_NAV: { slug: string; label: string }[] = LEGAL_DOCS.map(d => ({
  slug: d.slug,
  label: d.title.replace(" & Cancellation Policy", "").replace(" Policy", "").replace("Terms of Service", "Terms"),
}));

export const getLegalDoc = (slug: string): LegalDoc | undefined => LEGAL_DOCS.find(d => d.slug === slug);
