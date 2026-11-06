// The inbound catalogue: every tool a business can connect so that its events
// become WhatsApp messages — what it does for them, how they connect it, and
// what it sends us. (CRMs, Slack and Teams live in the outbound hub,
// src/lib/integrations.ts; this is the other direction.)
//
// Pure data, imported by the portal and the server alike, so the screen a
// business sees and the checks the server applies come from one list. A tool
// is "available" only when its connector exists; "next" ones are shown so a
// business knows they are coming, with the honest reason they are not here yet.

export type IntegrationCategory = "ecommerce" | "payments" | "scheduling" | "leads" | "automation";

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  ecommerce: "Online store & shipping",
  payments: "Payments",
  scheduling: "Appointments & bookings",
  leads: "Lead sources & forms",
  automation: "Automation tools",
};

export interface IntegrationField {
  key: string;
  label: string;
  /** Stored encrypted and never shown again. */
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}

/** A value an automation can put into a template, e.g. {{payload.order_name}}. */
export interface EventField { token: string; label: string; sample: string }

export interface CatalogEvent {
  /** What automations listen for: "<id>.<what happened>". */
  key: string;
  label: string;
  /** What a business typically sends when it happens. */
  suggestion: string;
  fields: EventField[];
}

export interface CatalogEntry {
  id: string;
  name: string;
  category: IntegrationCategory;
  /** Brand colour for the monogram tile — shown when there is no logo, or it fails to load. */
  color: string;
  /** The company's own mark, self-hosted under public/integrations (sources: integration-logos.test.ts). */
  logo?: string;
  blurb: string;
  /** What a business gets from connecting it, in its own words. */
  gives: string[];
  availability: "available" | "builtin" | "next";
  /** For "next": why it is not here yet. */
  pending?: string;
  docsUrl?: string;
  fields?: IntegrationField[];
  /**
   * A secret the portal makes for the business to paste into the tool (a webhook
   * signing secret the tool lets them choose). Shown with the webhook URL.
   */
  generated?: { key: string; label: string };
  /** False when the tool needs no URL from us (Calendly: the portal subscribes itself). */
  showsWebhookUrl?: boolean;
  /** Where in the tool the URL and secret go, step by step. */
  steps?: string[];
  events?: CatalogEvent[];
  /**
   * Connected by sharing with the portal's Google service account rather than
   * pasting a key: the panel shows the address to share with.
   */
  shareWithGoogle?: "sheet" | "calendar";
  /** The portal reads the tool on a schedule; nothing is posted to us, so no URL. */
  polled?: boolean;
  /** No incoming events at all: the card only opens the account connection (accountLinks). */
  accountOnly?: boolean;
}

const COUNTRY_FIELD: IntegrationField = {
  key: "defaultCountryCode", label: "Default country code", placeholder: "91",
  hint: "Used when the tool sends a phone number without one. 91 for India.",
};
const TAGS_FIELD = (example: string): IntegrationField => ({
  key: "tags", label: "Tag these contacts as", placeholder: example, hint: "Comma-separated. Leave blank for the default.",
});

const NAME: EventField = { token: "contact.name", label: "Customer name", sample: "Asha Verma" };
const p = (key: string, label: string, sample: string): EventField => ({ token: `payload.${key}`, label, sample });

const ORDER_FIELDS = [NAME, p("order_name", "Order number", "#1042"), p("total", "Order total", "₹2,499"), p("items", "Items", "Blue Kurta and 1 more"), p("status_url", "Order status link", "https://shop.example/orders/…")];

export const CATALOG: CatalogEntry[] = [
  {
    id: "shopify", name: "Shopify", category: "ecommerce", color: "#5E8E3E", logo: "/integrations/shopify.svg", availability: "available",
    blurb: "Order confirmations, shipping updates and abandoned-cart recovery on WhatsApp.",
    gives: [
      "Order confirmed — with the order number, total and status link",
      "Shipped, out for delivery, delivered — with the tracking link",
      "Abandoned checkout: a reminder with the recovery link, cancelled automatically if they order",
      "Cash-on-delivery orders flagged, so you can ask the buyer to confirm before shipping",
    ],
    docsUrl: "https://help.shopify.com/en/manual/fulfillment/setup/notifications/webhooks",
    fields: [
      { key: "signingKey", label: "Webhook signing key", secret: true, hint: "Add it after your first webhook exists: Shopify shows it under the webhooks list (\"Your webhooks will be signed with …\"). Until it is saved, Shopify's deliveries are refused." },
      { key: "shopDomain", label: "Store domain (optional)", placeholder: "yourstore.myshopify.com", hint: "If set, deliveries from any other store are refused." },
      TAGS_FIELD("Shopify customer"), COUNTRY_FIELD,
    ],
    steps: [
      "In Shopify admin, open Settings → Notifications → Webhooks.",
      "Click Create webhook. Event: Order creation. Format: JSON. URL: the webhook URL above. Save.",
      "Repeat for each event you want: Order payment, Order fulfillment, Order cancellation, Fulfillment update (tracking), Checkout creation (abandoned carts).",
      "Copy the signing key shown under your webhooks list, then Edit settings here and paste it.",
    ],
    events: [
      { key: "shopify.order_created", label: "Order placed", suggestion: "Order confirmation with the order number and total", fields: ORDER_FIELDS },
      { key: "shopify.order_paid", label: "Order paid", suggestion: "Payment received", fields: ORDER_FIELDS },
      { key: "shopify.order_fulfilled", label: "Order shipped", suggestion: "Shipped, with the tracking link", fields: [...ORDER_FIELDS, p("tracking_url", "Tracking link", "https://track.example/…"), p("courier", "Courier", "Delhivery")] },
      { key: "shopify.shipment_update", label: "Shipping status changed", suggestion: "Out for delivery / delivered", fields: [NAME, p("shipment_status", "Status", "out for delivery"), p("tracking_url", "Tracking link", "https://track.example/…")] },
      { key: "shopify.order_cancelled", label: "Order cancelled", suggestion: "Cancellation notice", fields: [...ORDER_FIELDS, p("cancel_reason", "Reason", "customer")] },
      { key: "shopify.checkout_started", label: "Checkout started (abandoned cart)", suggestion: "Send 1 hour later: \"You left something behind\" with the recovery link", fields: [NAME, p("recovery_url", "Recovery link", "https://shop.example/checkouts/…"), p("total", "Cart total", "₹2,499"), p("items", "Items", "Blue Kurta")] },
    ],
  },
  {
    id: "woocommerce", name: "WooCommerce", category: "ecommerce", color: "#7F54B3", logo: "/integrations/woocommerce.png", availability: "available",
    blurb: "Order confirmations and every order-status change from your WordPress store.",
    gives: ["Order received / processing / completed messages", "Failed and cancelled order follow-ups", "Payment link for unpaid orders"],
    docsUrl: "https://woocommerce.com/document/webhooks/",
    generated: { key: "webhookSecret", label: "Secret" },
    fields: [TAGS_FIELD("WooCommerce customer"), COUNTRY_FIELD],
    steps: [
      "In WordPress, open WooCommerce → Settings → Advanced → Webhooks → Add webhook.",
      "Status: Active. Topic: Order created. Delivery URL: the webhook URL above. Secret: the secret above. Save.",
      "Add a second webhook the same way with Topic: Order updated, for status changes.",
    ],
    events: [
      { key: "woocommerce.order_created", label: "Order placed", suggestion: "Order confirmation", fields: [NAME, p("order_number", "Order number", "1042"), p("total", "Total", "₹2,499"), p("items", "Items", "Blue Kurta"), p("payment_url", "Payment link (unpaid orders)", "https://shop.example/checkout/…")] },
      { key: "woocommerce.order_processing", label: "Order processing", suggestion: "We're packing your order", fields: [NAME, p("order_number", "Order number", "1042")] },
      { key: "woocommerce.order_completed", label: "Order completed", suggestion: "Delivered — thank you, plus a review request", fields: [NAME, p("order_number", "Order number", "1042")] },
      { key: "woocommerce.order_cancelled", label: "Order cancelled", suggestion: "Cancellation notice", fields: [NAME, p("order_number", "Order number", "1042")] },
      { key: "woocommerce.order_failed", label: "Payment failed", suggestion: "Help them finish the payment", fields: [NAME, p("order_number", "Order number", "1042"), p("payment_url", "Payment link", "https://shop.example/checkout/…")] },
    ],
  },
  {
    id: "shiprocket", name: "Shiprocket", category: "ecommerce", color: "#7350FF", logo: "/integrations/shiprocket.png", availability: "next",
    blurb: "Shipping updates — picked up, out for delivery, delivered, RTO — for every courier.",
    gives: ["Out-for-delivery and delivered messages", "Failed-delivery and RTO alerts so the buyer can reschedule"],
    pending: "Shiprocket's updates don't include the buyer's phone, so the portal must look each order up with a Shiprocket API user. Coming in the next wave.",
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  {
    id: "razorpay", name: "Razorpay", category: "payments", color: "#0C2451", logo: "/integrations/razorpay.svg", availability: "available",
    blurb: "Payment receipts, failed-payment nudges, payment-link and subscription updates on WhatsApp.",
    gives: [
      "A receipt on WhatsApp the moment a payment is captured",
      "A nudge with help when a payment fails",
      "Payment-link paid confirmations (fees, invoices, bookings)",
      "Subscription renewals and halted-subscription alerts",
    ],
    docsUrl: "https://razorpay.com/docs/webhooks/setup-edit-payments/",
    generated: { key: "webhookSecret", label: "Secret" },
    fields: [
      { key: "keyId", label: "API key id (optional)", placeholder: "rzp_live_…", hint: "Only needed to send payment links from the portal later. Razorpay → Account & Settings → API Keys." },
      { key: "keySecret", label: "API key secret (optional)", secret: true },
      TAGS_FIELD("Razorpay customer"), COUNTRY_FIELD,
    ],
    steps: [
      "In Razorpay Dashboard, open Account & Settings → Webhooks → Add New Webhook.",
      "Webhook URL: the URL above. Secret: the secret above.",
      "Tick the events: payment.captured, payment.failed, payment_link.paid, refund.processed, subscription.charged, subscription.halted. Create.",
      "Do it once in Test mode to try it, and once in Live mode.",
    ],
    events: [
      { key: "razorpay.payment_captured", label: "Payment received", suggestion: "Receipt with the amount and payment id", fields: [NAME, p("amount", "Amount", "₹19,080"), p("payment_id", "Payment id", "pay_Abc123"), p("description", "Description", "Course fee")] },
      { key: "razorpay.payment_failed", label: "Payment failed", suggestion: "\"Your payment didn't go through — here's how to retry\"", fields: [NAME, p("amount", "Amount", "₹19,080"), p("error", "Reason", "Payment declined by bank")] },
      { key: "razorpay.payment_link_paid", label: "Payment link paid", suggestion: "Thank-you and receipt", fields: [NAME, p("amount", "Amount paid", "₹19,080"), p("reference_id", "Your reference", "INST-1042"), p("description", "Description", "Installment 2")] },
      { key: "razorpay.refund_processed", label: "Refund processed", suggestion: "Refund confirmation", fields: [NAME, p("amount", "Refund amount", "₹499"), p("refund_id", "Refund id", "rfnd_Abc123")] },
      { key: "razorpay.subscription_charged", label: "Subscription renewed", suggestion: "Renewal receipt", fields: [NAME, p("amount", "Amount", "₹999")] },
      { key: "razorpay.subscription_halted", label: "Subscription halted", suggestion: "\"Your subscription is paused — update your payment method\"", fields: [NAME, p("amount", "Amount due", "₹999")] },
    ],
  },
  {
    id: "cashfree", name: "Cashfree", category: "payments", color: "#5C2D91", logo: "/integrations/cashfree.png", availability: "available",
    blurb: "Payment receipts, and a helpful nudge when a payment fails or is abandoned.",
    gives: [
      "A receipt on WhatsApp the moment a payment succeeds",
      "A nudge with help when a payment fails",
      "A reminder when someone leaves the payment page",
      "A pending failed-payment message is cancelled if they pay first",
    ],
    docsUrl: "https://www.cashfree.com/docs/payments/online/webhooks/configure",
    fields: [
      { key: "clientSecret", label: "Client secret", secret: true, required: true, hint: "Cashfree Dashboard → Developers → API Keys. Cashfree signs every webhook with it. Test and Live mode have different secrets." },
      TAGS_FIELD("Cashfree customer"), COUNTRY_FIELD,
    ],
    steps: [
      "In the Cashfree Dashboard, open Developers → Webhooks → Add Webhook Endpoint.",
      "Endpoint URL: the URL above.",
      "Choose the Payments events: success, failed and user dropped. Save.",
      "Paste your client secret here (Developers → API Keys) so the portal can check each webhook really came from Cashfree.",
      "Make a test payment in Test mode and check it appears under Recent events.",
    ],
    events: [
      { key: "cashfree.payment_success", label: "Payment received", suggestion: "Receipt with the amount and order id", fields: [NAME, p("amount", "Amount", "₹1,499"), p("order_id", "Order id", "order_1042"), p("payment_id", "Payment id", "1453995084705707520")] },
      { key: "cashfree.payment_failed", label: "Payment failed", suggestion: "\"Your payment didn't go through — here's how to retry\"", fields: [NAME, p("amount", "Amount", "₹1,499"), p("error", "Reason", "Payment declined by bank")] },
      { key: "cashfree.payment_dropped", label: "Left the payment page", suggestion: "\"Need help finishing your payment?\"", fields: [NAME, p("amount", "Amount", "₹1,499"), p("order_id", "Order id", "order_1042")] },
    ],
  },

  // ── Appointments & bookings ───────────────────────────────────────────────
  {
    id: "calendly", name: "Calendly", category: "scheduling", color: "#006BFF", logo: "/integrations/calendly.svg", availability: "available",
    blurb: "Booking confirmations, reschedules and cancellations on WhatsApp, with the meeting link.",
    gives: ["Booking confirmed — with the date, time and join link", "Rescheduled and cancelled notices", "A pending confirmation is cancelled if they cancel first"],
    docsUrl: "https://developer.calendly.com/api-docs",
    showsWebhookUrl: false,
    fields: [
      { key: "apiToken", label: "Personal access token", secret: true, required: true, hint: "In Calendly, open your profile menu → Developer (or calendly.com/integrations → API & Webhooks) → Personal access tokens. Webhooks need a paid Calendly plan." },
      TAGS_FIELD("Calendly booking"), COUNTRY_FIELD,
    ],
    steps: [
      "In Calendly, create a personal access token: profile menu → Developer → Personal access tokens.",
      "Paste it here and connect — the portal sets up the webhook in Calendly for you.",
      "For phone numbers, turn on \"text reminders\" or add a phone question on your event types.",
    ],
    events: [
      { key: "calendly.booking_created", label: "Booking made", suggestion: "Confirmation with the time and join link", fields: [NAME, p("meeting", "Meeting", "Free counselling session"), p("when", "Date & time", "Fri, 30 Oct, 4:30 pm"), p("join_url", "Join link", "https://zoom.us/j/…")] },
      { key: "calendly.booking_rescheduled", label: "Booking rescheduled", suggestion: "New time confirmation", fields: [NAME, p("meeting", "Meeting", "Free counselling session"), p("when", "New date & time", "Sat, 31 Oct, 11:00 am")] },
      { key: "calendly.booking_canceled", label: "Booking cancelled", suggestion: "\"Sorry we missed you — rebook here\"", fields: [NAME, p("meeting", "Meeting", "Free counselling session"), p("cancel_reason", "Reason", "Something came up")] },
    ],
  },
  {
    id: "calcom", name: "Cal.com", category: "scheduling", color: "#111111", logo: "/integrations/calcom.png", availability: "available",
    blurb: "Booking confirmations, reschedules and cancellations from Cal.com on WhatsApp.",
    gives: ["Booking confirmed — with the date, time and meeting link", "Rescheduled and cancelled notices"],
    docsUrl: "https://cal.com/docs/developing/guides/automation/webhooks",
    generated: { key: "webhookSecret", label: "Secret" },
    fields: [TAGS_FIELD("Cal.com booking"), COUNTRY_FIELD],
    steps: [
      "In Cal.com, open Settings → Developer → Webhooks → New.",
      "Subscriber URL: the URL above. Secret: the secret above.",
      "Event triggers: Booking created, Booking rescheduled, Booking cancelled. Save.",
      "Add a phone-number question to your booking form so the portal can reach the attendee.",
    ],
    events: [
      { key: "calcom.booking_created", label: "Booking made", suggestion: "Confirmation with the time and meeting link", fields: [NAME, p("meeting", "Meeting", "Demo call"), p("when", "Date & time", "Fri, 30 Oct, 4:30 pm"), p("meeting_url", "Meeting link", "https://cal.com/video/…")] },
      { key: "calcom.booking_rescheduled", label: "Booking rescheduled", suggestion: "New time confirmation", fields: [NAME, p("meeting", "Meeting", "Demo call"), p("when", "New date & time", "Sat, 31 Oct, 11:00 am")] },
      { key: "calcom.booking_cancelled", label: "Booking cancelled", suggestion: "Rebooking link", fields: [NAME, p("meeting", "Meeting", "Demo call"), p("cancel_reason", "Reason", "Something came up")] },
    ],
  },
  {
    id: "google_calendar", name: "Google Calendar", category: "scheduling", color: "#1A73E8", logo: "/integrations/google_calendar.svg", availability: "available",
    blurb: "Customers book a time on your Google Calendar from inside a chat.",
    gives: [
      "A flow's “Book meeting” step offers your free times, read live from your calendar",
      "The booking lands on your calendar with the customer's name and WhatsApp number",
      "Only your working hours and days are offered, with the notice you choose",
    ],
    docsUrl: "https://support.google.com/calendar/answer/37082",
    showsWebhookUrl: false,
    shareWithGoogle: "calendar",
    // Nothing comes IN from a calendar: it is connected as an account (the
    // Integrations tab's google_calendar connection) that flows book into.
    accountOnly: true,
  },

  // ── Lead sources & forms ──────────────────────────────────────────────────
  {
    id: "indiamart", name: "IndiaMART", category: "leads", color: "#2E3192", logo: "/integrations/indiamart.png", availability: "available",
    blurb: "Every IndiaMART buyer enquiry greeted on WhatsApp within seconds, with the product they asked about.",
    gives: ["Instant WhatsApp reply to every enquiry — before competitors call", "Enquiries land in Contacts, tagged with the product", "Works with paid IndiaMART seller plans (Lead Manager)"],
    docsUrl: "https://help.indiamart.com/knowledge-base/integration-of-indiamarts-lead-manager-crm-push-api-with-third-party-crms-real-time-push-of-leads/",
    fields: [TAGS_FIELD("IndiaMART lead"), COUNTRY_FIELD],
    steps: [
      "In IndiaMART Seller panel, open Lead Manager → Import/Export → Push API.",
      "Choose \"Other\", paste the webhook URL above, and confirm with the OTP IndiaMART sends.",
    ],
    events: [
      { key: "indiamart.lead_received", label: "New enquiry", suggestion: "Thank them and share the product brochure or price", fields: [NAME, p("product", "Product asked about", "Industrial Mixer 50L"), p("city", "City", "Pune"), p("message", "Their message", "Need price for 2 units")] },
    ],
  },
  {
    id: "typeform", name: "Typeform", category: "leads", color: "#262627", logo: "/integrations/typeform.png", availability: "available",
    blurb: "Greet everyone who fills your Typeform on WhatsApp, using their answers.",
    gives: ["Instant WhatsApp follow-up to every submission", "Answers available in the message: {{payload.your_field_ref}}"],
    docsUrl: "https://www.typeform.com/developers/webhooks/",
    generated: { key: "webhookSecret", label: "Secret" },
    fields: [TAGS_FIELD("Typeform lead"), COUNTRY_FIELD],
    steps: [
      "In your form, open Connect → Webhooks → Add a webhook. Paste the URL above.",
      "Edit the webhook and paste the secret above into Secret. Turn it on.",
      "Use a Phone number question so the portal gets a WhatsApp-ready number.",
    ],
    events: [
      { key: "typeform.form_submitted", label: "Form submitted", suggestion: "Thank them and share the next step", fields: [NAME, p("form", "Form name", "Course enquiry"), p("course", "An answer (by its field ref)", "Data Science")] },
    ],
  },
  {
    id: "meta_lead_ads", name: "Facebook & Instagram Lead Ads", category: "leads", color: "#0866FF", logo: "/integrations/meta_lead_ads.svg", availability: "next",
    blurb: "Message every Lead Ad lead on WhatsApp the second they submit the form.",
    gives: ["Instant first message to ad leads", "Lead Ad answers in Contacts"],
    pending: "Built and waiting on Meta: reading a lead needs the leads_retrieval permission, which Meta grants through app review. Once approved, each lead arrives as a contact (with its ad) and raises the meta_lead_ads.lead event, so a message rule can greet it on WhatsApp.",
  },
  {
    id: "justdial", name: "JustDial", category: "leads", color: "#FF6F00", logo: "/integrations/justdial.png", availability: "next",
    blurb: "JustDial enquiries greeted on WhatsApp.",
    gives: ["Instant reply to JustDial leads"],
    pending: "JustDial has no public lead API; it is set up through your JustDial account manager. Use the Webhooks integration with them meanwhile.",
  },
  {
    id: "google_sheets", name: "Google Sheets", category: "leads", color: "#0F9D58", logo: "/integrations/google_sheets.svg", availability: "available",
    blurb: "Message people from rows in a sheet, and log your leads into one.",
    gives: [
      "A row added to a tab → a WhatsApp message, with the row's columns in the template",
      "Each row's status written back into the sheet: sent, skipped or failed, and why",
      "Rows already in the tab when you connect are marked and never messaged",
    ],
    docsUrl: "https://support.google.com/docs/answer/9331169",
    showsWebhookUrl: false,
    shareWithGoogle: "sheet",
    polled: true,
    fields: [
      { key: "spreadsheetUrl", label: "Sheet link", required: true, placeholder: "https://docs.google.com/spreadsheets/d/…", hint: "Open the sheet and copy the address from your browser." },
      { key: "sendTab", label: "Message new rows from this tab", required: true, placeholder: "e.g. Send", hint: "Its first row needs a Phone column. A \"Portal status\" column is added to it." },
      TAGS_FIELD("Google Sheets"), COUNTRY_FIELD,
    ],
    events: [
      { key: "google_sheets.row_added", label: "New row in the sheet", suggestion: "A fee reminder, a welcome, an event invite: whatever the tab is for", fields: [NAME, p("your_column", "Any column, by its header (Fee Amount → fee_amount)", "₹12,000"), p("row", "Row number", "42")] },
    ],
  },

  // ── CRM ───────────────────────────────────────────────────────────────────
  {
    id: "webhook", name: "Zapier, Make, Pabbly, n8n or your website form", category: "automation", color: "#FF4A00", logo: "/integrations/webhook.svg", availability: "available",
    blurb: "Let Zapier, Make, Pabbly Connect, n8n, your website form or your own system send each new lead here — and greet them on WhatsApp straight away.",
    gives: ["Greet a new lead on WhatsApp seconds after they fill any form", "Send a message whenever another tool says something happened", "Every person who comes in lands in Contacts, tagged"],
    fields: [
      { key: "eventName", label: "Event name", placeholder: "lead", hint: "A short name for what this source sends, e.g. lead, signup, enquiry. (If the data has its own \"event\" field, that wins.)" },
      { key: "phonePath", label: "Phone field (optional)", placeholder: "phone", hint: "Only if the phone is not in a field called phone, mobile or whatsapp. Nested: lead.mobile" },
      { key: "namePath", label: "Name field (optional)", placeholder: "name" },
      TAGS_FIELD("Webhook lead"), COUNTRY_FIELD,
    ],
    steps: [
      "Copy the address above.",
      "In Zapier / Make / Pabbly, add a \"Webhook — POST\" step (or set your form's webhook) and paste the URL.",
      "Send JSON or form fields, including the person's phone number. Name and email are optional.",
      "Every field you send can be used in your message, e.g. {{payload.city}} for a field called city.",
    ],
    events: [
      { key: "webhook.lead", label: "A new lead comes in (event: lead)", suggestion: "Welcome the lead and share the next step", fields: [NAME, p("source", "Any field you send, e.g. source", "Website")] },
    ],
  },

  // ── Team alerts ───────────────────────────────────────────────────────────
];

export const CATALOG_BY_ID = new Map(CATALOG.map(c => [c.id, c]));

/** Tools that run on a the portal connector (not built-ins like LeadSquared, not "next"). */
export const CONNECTABLE = new Set(CATALOG.filter(c => c.availability === "available" && !c.accountOnly).map(c => c.id));

/** The catalogue entry an event key belongs to: "shopify.order_created" → shopify. */
export function entryForEvent(eventKey: string): CatalogEntry | undefined {
  return CATALOG_BY_ID.get(eventKey.split(".")[0]);
}
