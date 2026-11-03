// Legal content for Talko AI — single source of truth for all policy documents
// (Terms, Privacy, Acceptable Use, Refunds, Cookies). Pure data, no JSX, usable
// from server components and the sitemap.
//
// STILL NEEDED from the business (not guessable, so not filled in): the
// registered address, the type of entity PM TECHNOLOGIES is, and a named
// grievance officer (India IT Rules 2021 / DPDP Act). Have counsel review these
// documents before relying on them.

// Version stamp recorded against each signup's consent + shown as the effective
// date. Bump LEGAL_VERSION whenever the substance of a document changes so we can
// tell which version a user agreed to.
export const LEGAL_VERSION = "2026-11-03";
export const LEGAL_EFFECTIVE = "3 November 2026";

export const LEGAL_META = {
  // Talko AI is a product operated by the registered parent company PM TECHNOLOGIES.
  company: "Talko AI",
  legalEntity: "PM TECHNOLOGIES",
  contactEmail: "info@thetalko.in",
  privacyEmail: "info@thetalko.in",
  jurisdiction: "New Delhi, India",
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

// Who processes personal data for us — one list, shown in the Privacy Policy
// and on its own page. Kept in step with the code: every outside service the
// app sends personal data to belongs here.
export const SUBPROCESSORS: { name: string; purpose: string; data: string; location?: string }[] = [
  { name: "Vercel Inc.", purpose: "hosts the website and app, and provides cookieless page-view and speed measurement.", data: "all data passing through the app while it is processed; page addresses without ids.", location: "United States" },
  { name: "Supabase, Inc.", purpose: "managed database and file storage.", data: "account data, your workspace's contacts, messages and files.", location: "the hosting region configured for our project" },
  { name: "Meta Platforms", purpose: "sends and receives messages and comments on WhatsApp, Instagram and Messenger.", data: "message content, phone numbers and profile ids of the people you message.", location: "United States / Ireland" },
  { name: "Google LLC (YouTube and Business Profile APIs)", purpose: "reads, posts and moderates comments on a YouTube channel you connect, and reads and replies to reviews on a Business Profile you connect.", data: "comments, reviews and the replies you send.", location: "United States" },
  { name: "Google LLC (Sheets and Calendar APIs)", purpose: "only where you connect them: adds your leads to a Google Sheet you share with us, reads the rows you ask us to message, and reads free times on and adds bookings to a Google Calendar you share.", data: "lead and contact names, phone numbers, email addresses and messages; the sheet rows you choose; booking times.", location: "United States" },
  { name: "Google LLC (Gemini API)", purpose: "turns your knowledge-base documents and incoming customer questions into search vectors so the AI can find the right answer — on our account unless you connect your own Gemini key.", data: "knowledge-base text and the text of customer questions.", location: "United States" },
  { name: "AI provider you choose (Google Gemini, OpenAI or Anthropic)", purpose: "writes AI replies using your own API key, under your own agreement with that provider.", data: "the conversation and knowledge-base text needed for each reply.", location: "United States" },
  { name: "OpenAI, L.L.C.", purpose: "screens outbound messages and uploaded images against our content-safety rules before they are sent, on our key for every business.", data: "the outbound message text and images.", location: "United States" },
  { name: "Resend", purpose: "delivers our emails: sign-in codes, invoices, digests and announcements.", data: "email address, the email content and delivery events.", location: "United States" },
  { name: "Razorpay and Stripe", purpose: "take payment for subscriptions.", data: "name, email, phone and payment details (card details are held by them, never by us).", location: "India (Razorpay), United States (Stripe)" },
  { name: "Google LLC (Google Analytics)", purpose: "website analytics — only for visitors who accept optional cookies, and only on our marketing website and sign-up page.", data: "pages visited, referrer, approximate location and device details.", location: "United States" },
  { name: "CARTO", purpose: "map images in the ad-targeting map inside the app.", data: "your IP address and the map area viewed." },
];

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
      p(`${C} is a multi-channel conversational platform that lets businesses connect WhatsApp, Instagram, Facebook Messenger, a YouTube channel, a Google Business Profile and a website web-chat widget, automate replies with AI, run broadcasts, build chatbot flows and drip sequences, moderate and reply to comments and reviews, and manage conversations from a unified inbox.`),
      p(`The Service connects to third-party platforms (such as Meta's WhatsApp, Instagram and Messenger APIs, and Google's YouTube Data API and Business Profile APIs) and to AI providers, using credentials and API keys or OAuth authorisations that you supply. Your use of those platforms remains subject to their own terms and policies.`),
    ] },
    { heading: "3. Eligibility and accounts", blocks: [
      p(`You must be at least 18 years old and capable of forming a binding contract, and you must be using the Service for a business, not as a consumer for personal or household purposes. You are responsible for the accuracy of the information you provide and for keeping it up to date.`),
      p(`You are responsible for safeguarding your account credentials and for all activity that occurs under your account. You must notify us promptly at ${CONTACT} of any unauthorised use. Each business account is isolated from others; you may invite team members subject to the seat limits of your plan.`),
    ] },
    { heading: "4. Free trial", blocks: [
      p(`We may offer a free trial period (typically 14 days). No payment details are needed for the trial, and you are not charged automatically when it ends. At the end of the trial, continued use of paid features requires an active paid plan. We may modify or discontinue trials at any time. Trial accounts are subject to the same Acceptable Use Policy as paid accounts.`),
    ] },
    { heading: "5. Plans, billing and taxes", blocks: [
      p(`Paid plans are billed in advance and renew automatically each month (or other period stated when you subscribe) until you cancel. By subscribing you authorise us, or our payment processor, to charge the plan fee to your chosen payment method on each renewal date. You can cancel at any time from the billing page in your account; see the Refund & Cancellation Policy.`),
      p(`The amount shown on the billing page before you pay is the full amount charged for each period — nothing is added at payment. We are not currently registered for GST, so no GST is charged; if that changes, we will tell you in advance and any tax will apply only from a later renewal. We may change plan pricing or features on reasonable notice; changes take effect at your next renewal. AI usage is billed directly to your own AI provider under the "bring your own key" model and is not charged by us.`),
      p(`Refunds and cancellations are governed by our Refund & Cancellation Policy.`),
    ] },
    { heading: "6. Acceptable use", blocks: [
      p(`Your use of the Service must comply at all times with our Acceptable Use Policy, including all messaging-platform rules around consent, opt-in, messaging windows and prohibited content. We may suspend or limit messaging that puts your connected accounts or our infrastructure at risk.`),
    ] },
    { heading: "7. Your content and data", blocks: [
      p(`You retain all rights to the content, contacts, messages and other data you submit to or generate through the Service ("Your Data"). You grant us a limited licence to host, process and transmit Your Data solely to provide, secure and support the Service and as described in our Privacy Policy. We do not use Your Data to train AI models, and we do not sell it or make it available to anyone else for that purpose.`),
      p(`You are responsible for Your Data and for having all necessary rights, consents and lawful bases to collect and process it, including the consent of the end-customers you message. With respect to personal data of your end-customers, you act as the data controller (a "data fiduciary" under India's Digital Personal Data Protection Act, 2023) and ${C} acts as your processor. If your customers include children (under 18 in India), you are responsible for obtaining verifiable consent from a parent or guardian where the law requires it.`),
    ] },
    { heading: "7A. AI-generated replies", blocks: [
      p(`Replies written by the AI features are generated automatically and sent in your business's name. Where the law or a platform's rules require it, you must make clear to your customers that they are talking to an automated assistant. You are responsible for checking that AI replies are accurate before relying on them.`),
    ] },
    { heading: "8. Third-party services", blocks: [
      p(`The Service integrates with third-party services including Meta (WhatsApp, Instagram, Messenger), Google (YouTube Data API Services, Business Profile APIs), payment processors, AI model providers and other tools you choose to connect. We are not responsible for third-party services, their availability, or changes to their APIs or policies, which may affect the Service. Your use of those services is governed by their own terms, including the YouTube Terms of Service (https://www.youtube.com/t/terms) where you connect a YouTube channel.`),
    ] },
    { heading: "9. Intellectual property", blocks: [
      p(`The Service, including its software, design, trademarks and content (excluding Your Data), is owned by ${C} or its licensors and is protected by intellectual-property laws. We grant you a limited, non-exclusive, non-transferable, revocable licence to use the Service for your internal business purposes during your subscription. You may not copy, modify, resell, reverse-engineer or create derivative works of the Service except as permitted by law.`),
      p(`If you provide feedback or suggestions, you grant us a perpetual, royalty-free licence to use them without restriction.`),
    ] },
    { heading: "10. Confidentiality", blocks: [
      p(`Each party may have access to the other's confidential information. Each party agrees to protect the other's confidential information with reasonable care and to use it only as needed to perform under these Terms.`),
    ] },
    { heading: "11. Availability and changes to the Service", blocks: [
      p(`We aim to keep the Service available but do not guarantee uninterrupted or error-free operation, and we do not offer a guaranteed uptime percentage or service credits. Current status is shown at /status. We may modify, suspend or discontinue features, perform maintenance, or impose usage limits to protect the integrity and security of the Service. We will use reasonable efforts to give notice of material adverse changes.`),
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
    { heading: "18. Copyright and content complaints", blocks: [
      p(`If you believe content handled through the Service infringes your copyright or other rights, or is otherwise unlawful, write to ${CONTACT} with: your contact details; the content concerned and where it appears; the right you say is infringed and why; and a statement that the information in your notice is accurate and that you are the rights holder or authorised to act for them. We review each notice, may remove or disable access to the content, and tell the business concerned so it can respond.`),
    ] },
    { heading: "19. Grievances", blocks: [
      p(`Complaints about the Service or about how we handle personal data can be sent to ${CONTACT}, marked "Grievance". We acknowledge complaints within 24 hours and aim to resolve them within 15 days.`),
    ] },
    { heading: "20. Contact", blocks: [
      p(`Questions about these Terms can be sent to ${CONTACT}. ${C} is operated by ${LEGAL_META.legalEntity}, ${LEGAL_META.jurisdiction}.`),
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
      p(`For the personal data of your end-customers that flows through the Service — the contacts and conversations on your connected WhatsApp, Instagram, Messenger and web-chat channels, and the comments and reviews on your connected YouTube channel and Google Business Profile — you are the data controller and ${C} acts as your data processor, processing that data on your instructions to provide the Service.`),
    ] },
    { heading: "3. Information we collect", blocks: [
      ul([
        "Account information: name, business name, email, phone, password (stored hashed), and — only if you choose to answer — the industry, team size, use-case and volume questions at sign-up.",
        "Consent records: the version of these policies you accepted and when, and whether you agreed to product news by email.",
        "Billing information: plan, subscription status and payment metadata. Card details are handled by our payment processor and are not stored by us.",
        "Channel & integration data: the credentials, API keys and OAuth tokens you connect (encrypted at rest), and the messages, contacts and media exchanged on your connected channels — including comments and video metadata from a connected YouTube channel, and reviews and business-location data from a connected Google Business Profile.",
        "AI keys: the AI provider keys you supply, stored encrypted and used only to generate replies for your account.",
        "Usage data: log data, feature usage and diagnostic information. IP addresses are used to limit sign-in and sign-up abuse and are deleted within about a day.",
        "Website analytics: only if you accept analytics in the cookie banner, Google Analytics records which pages you visit on our website. Vercel's privacy-friendly analytics counts page views and loading speed without cookies, with ids and query strings removed from addresses.",
        "Cookies and similar technologies, as described in our Cookie Policy.",
      ]),
    ] },
    { heading: "4. How we use information", blocks: [
      ul([
        "To provide, operate, secure and improve the Service.",
        "To authenticate users, manage accounts and process billing.",
        "To generate AI responses using the keys and knowledge base you provide.",
        "To send service, security and transactional communications, and product news by email if you agreed to it at sign-up (accounts created before 1 November 2026 receive it unless they unsubscribe). Every product-news email has an unsubscribe link.",
        "To detect, prevent and address fraud, abuse and security or technical issues.",
        "To comply with legal obligations and enforce our terms.",
      ]),
      p(`We do not use personal data in your workspace — including your customers' messages — to train AI models, and we do not sell it.`),
    ] },
    { heading: "5. Legal bases for processing", blocks: [
      p(`Where applicable law requires a legal basis, we rely on: performance of our contract with you; our legitimate interests in operating and securing the Service; your consent (which you may withdraw); and compliance with legal obligations.`),
    ] },
    { heading: "6. How we share information", blocks: [
      p(`We do not sell personal information. We share information only as needed to run the Service, with sub-processors and partners that are bound by appropriate confidentiality and data-protection obligations, including:`),
      ul([
        ...SUBPROCESSORS.map(sp => `${sp.name} — ${sp.purpose}`),
        "Professional advisers, and authorities where required by law or to protect rights and safety.",
      ]),
      p(`The full list, with what each receives and where, is on our Sub-processors page (/legal/subprocessors).`),
      p(`We may also disclose information in connection with a merger, acquisition or sale of assets, subject to this Policy.`),
      // Spelled out as its own paragraph rather than left as one bullet: this is
      // the limb platform data-handling reviews ask about directly, and a policy
      // that only gestures at it can't be pointed to as the answer.
      p(`Requests from public authorities. We may disclose personal information to courts, regulators, law-enforcement or other public authorities where we are legally required to do so. We assess each request for legal validity and scope, disclose only what the request compels rather than the wider account, keep a record of what was disclosed and to whom, and notify the affected business unless we are legally prohibited from doing so. We have not received a national-security request for personal information.`),
    ] },
    { heading: "7. Google API Services", blocks: [
      p(`Where you connect a YouTube channel or a Google Business Profile, ${C}'s use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy (https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Data obtained through YouTube API Services is also subject to the Google Privacy Policy (https://policies.google.com/privacy), and your use of a connected YouTube channel is subject to the YouTube Terms of Service (https://www.youtube.com/t/terms).`),
      p(`We use YouTube API Services and Google Business Profile data only to provide the comment-automation, moderation and review-reply features you enable for your own connected channel and Business Profile — never to serve ads, to train generalised AI or machine-learning models, or for any purpose you have not requested. Access tokens are stored encrypted and are used solely on your instructions. You can disconnect a channel or Business Profile from the Service at any time, and revoke the Service's access in your Google Account (https://myaccount.google.com/permissions).`),
    ] },
    { heading: "8. Browser extension (Talko Copilot)", blocks: [
      p(`Talko Copilot is our optional Chrome extension. It is a client of your own ${C} workspace: it communicates only with our API over HTTPS, using a workspace API key you create and paste in yourself, and it sends nothing to any third party.`),
      ul([
        "Stored on your device only: your workspace API key and your capture preferences, held in the browser's extension storage. Uninstalling the extension removes them.",
        "Sent to your workspace, and only when you act: the text you highlight, the contact details you choose to keep after pressing “Scan page”, the address of the page they came from, and the messages, tags, notes, pipeline changes and orders you create from the extension.",
        "Not collected: your browsing history, your page contents, cookies, form data, or anything from a page you have neither selected yourself nor asked the extension to scan.",
      ]),
      p(`The extension does not monitor the websites you visit and does nothing in the background. It reads a page in exactly two situations, both of which you start yourself. When you highlight text, its content script offers an action on that selection. When you press “Scan page”, it looks once through the visible text of the tab in front of you for names, phone numbers and email addresses, and lists what it found so you can review it — those results stay in the extension window and only the rows you tick are sent to your workspace; the rest are discarded when you close it. Nothing is captured, drafted, saved or sent without your click.`),
      p(`It does not act on your behalf inside WhatsApp, Instagram, Facebook, LinkedIn or any other platform — messages are sent through those platforms' official APIs by your ${C} workspace, subject to their messaging policies.`),
      p(`Leads and conversations created through the extension are stored in your own workspace and are treated exactly like data created in the portal: you remain the data controller and we act as your processor, as described in section 2. We do not sell extension data, use it for advertising, use it to train generalised AI models, or use it for any purpose other than providing the features you invoke.`),
    ] },
    { heading: "9. International transfers", blocks: [
      p(`${LEGAL_META.legalEntity} is established in ${LEGAL_META.governingLaw}, and your information may be processed outside your own country. In particular, the AI, hosting, email, analytics and content-safety providers named in section 6 — including Anthropic, PBC, OpenAI, L.L.C., Google LLC, Vercel Inc. and Resend — are established in the United States and process data there. Our managed database and file storage are provided by Supabase, Inc. in the hosting region configured for our workspace.`),
      p(`Where we transfer personal data internationally, we use appropriate safeguards, such as standard contractual clauses, where required by applicable law.`),
    ] },
    { heading: "10. Data retention", blocks: [
      p(`We retain personal information for as long as your account is active or as needed to provide the Service, and thereafter only as required to comply with legal obligations, resolve disputes and enforce agreements. You can request export or deletion of Your Data; on account termination we delete or anonymise data within a reasonable period, subject to legal retention requirements. If you disconnect a YouTube channel or Google Business Profile, we delete the associated OAuth tokens promptly and stop accessing the Google API on your behalf.`),
      p(`Some records are deleted automatically after a fixed time: website-visit attribution (ad click ids and campaign tags) after 90 days; records of how the AI routed each question after 180 days; cached AI answers after 90 days without use; questions the AI couldn't answer 180 days after they are dealt with, or 365 days if never dealt with; our email-sending log after 400 days; logs of incoming notifications from connected tools after 30 days; and the proof that a deletion request was carried out 3 years after it was completed. IP addresses used to limit sign-in abuse are deleted within about a day.`),
      p(`Your customers' conversations, contacts and orders stay in your workspace until you delete them, erase a customer, or close your account. Order records are anonymised rather than deleted when a customer is erased, because tax and company law require accounting records to be kept.`),
    ] },
    { heading: "11. Security", blocks: [
      p(`We use technical and organisational measures designed to protect personal information, including encryption of credentials, API keys and OAuth tokens at rest, per-business data isolation with row-level security, access controls and audit logging. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.`),
    ] },
    { heading: "12. Your rights", blocks: [
      p(`Depending on your location, you may have rights to access, correct, delete, export or restrict the processing of your personal data, and to object to processing or withdraw consent. To exercise these rights, contact ${PRIVACY}. Workspace admins can also do this themselves: Settings lets you export your workspace's data and erase a single customer's data. Where ${C} acts as a processor for end-customer data, requests from those individuals should be directed to the business that controls that data. You can revoke ${C}'s access to your Google account at any time via https://myaccount.google.com/permissions.`),
    ] },
    { heading: "13. Cookies", blocks: [
      p(`We use cookies and similar technologies as described in our Cookie Policy.`),
    ] },
    { heading: "14. Children", blocks: [
      p(`The Service is for businesses and people aged 18 or over, and we do not knowingly collect children's personal data for our own purposes. If you believe a child has signed up, contact us and we will delete the account.`),
      p(`Businesses using ${C} may message their own customers, who can include minors (for example, students). The business is the controller of that data and is responsible for any consent the law requires — including verifiable consent from a parent or guardian for anyone under 18 under India's Digital Personal Data Protection Act, 2023.`),
    ] },
    { heading: "15. Changes to this Policy", blocks: [
      p(`We may update this Privacy Policy from time to time. Material changes will be notified through the Service or by email, and the "last updated" date below will reflect the current version.`),
    ] },
    { heading: "16. Contact", blocks: [
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
      p(`Your connected channels remain subject to the policies of their providers, including the WhatsApp Business Messaging Policy, the WhatsApp Commerce Policy, Meta's Instagram and Messenger platform policies, the YouTube API Services Terms of Service and YouTube Community Guidelines, and the Google Business Profile content policies. You are responsible for complying with those policies. Violations can lead the providers to restrict or ban your numbers, accounts, Pages, channel or Business Profile, for which ${C} is not responsible.`),
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

// Refund & Cancellation. Modelled on what the market actually does (AiSensy,
// Interakt, WATI, Gallabox, DoubleTick and Zoko, read 3 Nov 2026): a period
// that has started is not refunded and cancelling stops the next renewal; the
// free trial is the try-before-you-pay window. On top of that, what is fair
// and safe to promise: a full refund for a charge made in error, and credit
// (or the unused part back) for an outage that is ours. Deliberately NOT
// promised: a pro-rata refund on cancelling, refunds of Meta's charges (Meta
// does not refund us), refunds after a ban by Meta, or a payout date the bank
// controls. No GST is charged (billing-tax.ts), so no GST credit note either.
const REFUND: LegalDoc = {
  slug: "refund",
  title: "Refund & Cancellation Policy",
  summary: `How trials, billing, cancellations and refunds work, and what is and isn't refunded.`,
  sections: [
    { heading: "1. Free trial", blocks: [
      p(`New accounts may start with a free trial (typically 14 days). No payment details are needed and nothing is charged when the trial ends. You can stop any time during the trial without being billed. If you do not subscribe to a paid plan, paid features become unavailable when the trial ends. The trial is the time to decide whether ${C} suits you; there is no separate money-back period after you subscribe.`),
    ] },
    { heading: "2. Subscription billing", blocks: [
      p(`Paid plans are billed in advance on a recurring basis (for example monthly). Your subscription renews automatically at the start of each billing period until you cancel. The amount shown on the billing page before you pay is the amount charged to your payment method on each renewal date; no GST is currently charged and nothing is added at payment. If a plan's price changes, you are told before the renewal it applies to.`),
    ] },
    { heading: "3. Cancellation", blocks: [
      p(`You can cancel your subscription at any time from the billing area of your account, or by contacting ${CONTACT}. There is no notice period and no cancellation fee. Cancellation stops future renewals; your plan remains active until the end of the current paid period, after which it will not renew.`),
      p(`Cancelling your subscription does not close your WhatsApp Business Account or stop Meta charging it for conversations. That account is yours, and you control it.`),
    ] },
    { heading: "4. What is refunded", blocks: [
      ul([
        `Charges made in error: a duplicate payment, a charge after you cancelled, a wrong amount, or a payment you did not authorise. These are refunded in full. Tell us within 30 days of the charge.`,
        `An outage that is ours: if the Service is unusable for more than 24 hours in a row because of a fault on our side, the affected days are credited to your next renewal; if you would rather leave over it, we refund the unused part of that period instead.`,
      ]),
    ] },
    { heading: "5. What is not refunded", blocks: [
      p(`Except as set out in section 4 or where the law requires otherwise:`),
      ul([
        `a billing period that has started, in whole or in part, including when you cancel or move to a smaller plan part-way through;`,
        `features, messages, seats or limits your plan allowed but you did not use;`,
        `setup, training or flow-building work charged separately, once it has been delivered;`,
        `charges made by Meta, or by any AI provider whose key you connect: those are billed by them directly to your own accounts and never reach us;`,
        `fees for a period in which your account was restricted by WhatsApp or Meta, or suspended by us, because of how it was used (for example spam, purchased contact lists or content Meta forbids).`,
      ]),
    ] },
    { heading: "6. How to ask for a refund", blocks: [
      p(`Email ${CONTACT} from the address you sign in with, with your workspace name, the payment reference, and what went wrong. We acknowledge within 2 business days and give you a decision within 7 business days, with the reason if it is a no. An approved refund goes back to the payment method you paid with, through Razorpay or Stripe; it usually reaches you in 5 to 10 business days, but the last step is your bank's or card issuer's and we cannot speed it up.`),
      p(`Please ask us before raising a chargeback with your bank: most problems are fixed faster that way. While a chargeback is open, scheduled sending on the workspace may be paused; your data and inbox are not touched, and sending resumes when it is resolved.`),
    ] },
    { heading: "7. Plan changes", blocks: [
      p(`To change plans while a subscription is running, contact ${CONTACT} and we will move you over without charging twice; or cancel and choose the new plan when the current period ends. Some features and limits change with your plan.`),
    ] },
    { heading: "8. Failed payments", blocks: [
      p(`If a renewal payment fails, we may retry the charge and may suspend or downgrade access until payment succeeds. Accounts left unpaid may be cancelled.`),
    ] },
    { heading: "9. Contact", blocks: [
      p(`For any billing question, contact ${CONTACT}. If this policy and the Terms of Service ever disagree about refunds or cancellation, this policy applies.`),
    ] },
  ],
};

const COOKIES: LegalDoc = {
  slug: "cookies",
  title: "Cookie Policy",
  summary: `The cookies and similar technologies we use, and how to manage them.`,
  sections: [
    { heading: "1. What are cookies", blocks: [
      p(`Cookies are small text files stored on your device when you visit a website. Local storage is a similar store in your browser. We use both, as listed below.`),
    ] },
    { heading: "2. Your choice", blocks: [
      p(`On your first visit to our website we ask whether you accept optional cookies. "Accept" and "Reject" are equally easy, and until you choose, only essential cookies are used. You can change your answer at any time with "Cookie settings" at the bottom of every page; choosing "Reject" later stops Google Analytics and removes its cookies.`),
    ] },
    { heading: "3. Essential cookies (always on)", blocks: [
      p(`These keep the site and your account working and secure. They are not used for analytics or advertising.`),
      ul([
        "talko_consent — remembers your cookie choice. 6 months.",
        "wa_admin_session — keeps you signed in to your workspace. 7 days.",
        "wa_device_id — remembers a device you've verified, so you aren't asked for a code every time. 180 days.",
        "wa_pending_login, wa_pending_signup, wa_pk_challenge — hold a sign-in or sign-up while you enter the code we send or use a passkey. 5–15 minutes.",
        "yt_oauth_state, gr_oauth_state — protect the connection to YouTube or Google Business Profile while you connect it. 10 minutes.",
        "wa_partner_session, wa_affiliate_session — keep partners and affiliates signed in to their own dashboards. 7 and 30 days.",
      ]),
    ] },
    { heading: "4. Optional cookies (only if you accept)", blocks: [
      ul([
        "Google Analytics (_ga, _ga_<id>) — tells us which pages of our website people visit and where they came from. Set by Google; up to 2 years. Not loaded at all unless you accept.",
        "talko_ref — remembers the affiliate link you arrived through, so the affiliate can be credited if you sign up later. 30 days. If you reject, a sign-up made straight from the affiliate link is still credited, without a cookie.",
      ]),
    ] },
    { heading: "5. Local storage", blocks: [
      ul([
        "Website chat — once you send a message in the chat on our website (or a business's website using our chat), a visitor id is kept so the conversation continues across pages. The campaign tags in the page address (utm_…) are kept too once you've chatted or accepted optional cookies.",
        "Workspace preferences — interface choices inside the app, such as a collapsed panel or a finished product tour.",
      ]),
    ] },
    { heading: "6. Cookieless measurement", blocks: [
      p(`Vercel Analytics and Speed Insights count page views and measure loading speed without cookies or local storage. Page addresses are stripped of query strings and ids before they are sent.`),
    ] },
    { heading: "7. Managing cookies", blocks: [
      p(`Besides "Cookie settings", most browsers let you block or delete cookies. Blocking essential cookies will stop you signing in.`),
    ] },
    { heading: "8. Contact", blocks: [
      p(`Questions about our use of cookies can be sent to ${PRIVACY}.`),
    ] },
  ],
};

const SUBPROCESSORS_DOC: LegalDoc = {
  slug: "subprocessors",
  title: "Sub-processors",
  summary: `The companies that process personal data for us to run ${C}, what each receives, and where.`,
  sections: [
    { heading: "1. About this list", blocks: [
      p(`${C} uses the service providers below to run the Service. Each receives only what it needs for the purpose shown. We will update this page before adding a new sub-processor that handles your customers' personal data.`),
    ] },
    { heading: "2. Sub-processors", blocks: [
      ul(SUBPROCESSORS.map(sp => `${sp.name} — ${sp.purpose} Receives: ${sp.data}${sp.location ? ` Location: ${sp.location}.` : ""}`)),
    ] },
    { heading: "3. Services you choose to connect", blocks: [
      p(`Integrations you switch on yourself — such as a CRM, a calendar, a spreadsheet or a payment gateway for your own customers — receive the data you send them under your own agreement with that provider. They are not our sub-processors.`),
    ] },
    { heading: "4. Contact", blocks: [
      p(`Questions about sub-processors, or a request for a data processing agreement, can be sent to ${PRIVACY}.`),
    ] },
  ],
};

export const LEGAL_DOCS: LegalDoc[] = [TERMS, PRIVACY_DOC, ACCEPTABLE_USE, REFUND, COOKIES, SUBPROCESSORS_DOC];

// Footer / nav order (slug → short label).
export const LEGAL_NAV: { slug: string; label: string }[] = LEGAL_DOCS.map(d => ({
  slug: d.slug,
  label: d.title.replace(" & Cancellation Policy", "").replace(" Policy", "").replace("Terms of Service", "Terms"),
}));

export const getLegalDoc = (slug: string): LegalDoc | undefined => LEGAL_DOCS.find(d => d.slug === slug);
