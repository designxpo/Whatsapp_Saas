import { describe, it, expect } from "vitest";
import { composeOtpEmail, EMAIL_OTP_EXPIRY_MINUTES } from "../emailotp";

// Rendering only — composeOtpEmail touches neither the DB nor Resend, which is
// why it's the seam these run against. What they lock in is everything that can
// break an OTP email silently: the code missing from the plain-text part (which
// is all a text-mode client shows), the expiry going unstated, the two purposes
// drifting into the same generic copy, and a CTA button creeping back in — the
// last one matters because "click here to verify" is indistinguishable from the
// phishing mail this email warns about.

const CODE = "4821";

describe("composeOtpEmail — the code itself", () => {
  it("carries the code in both MIME parts", () => {
    for (const purpose of ["signup", "login"] as const) {
      const { html, text } = composeOtpEmail(purpose, CODE);
      expect(html).toContain(CODE);
      expect(text).toContain(CODE);
    }
  });

  it("puts the code exactly once in the plain-text part", () => {
    // Two candidate codes in a text-mode client is worse than none — the reader
    // has no way to tell which four digits to type.
    for (const purpose of ["signup", "login"] as const) {
      const { text } = composeOtpEmail(purpose, CODE);
      expect(text.split(CODE).length - 1).toBe(1);
    }
  });

  it("renders the code in the large letter-spaced panel, not inline prose", () => {
    const { html } = composeOtpEmail("login", CODE);
    // The panel is what makes a code readable a character at a time; losing it
    // would still "contain the code" and pass every other assertion here.
    expect(html).toMatch(/letter-spacing:10px;[^>]*>4821/);
  });

  it("states how long the code lasts in both parts", () => {
    for (const purpose of ["signup", "login"] as const) {
      const { html, text } = composeOtpEmail(purpose, CODE);
      expect(html).toContain(`${EMAIL_OTP_EXPIRY_MINUTES} minutes`);
      expect(text).toContain(`${EMAIL_OTP_EXPIRY_MINUTES} minutes`);
    }
  });
});

describe("composeOtpEmail — no call to action", () => {
  it("emits no button for either purpose", () => {
    for (const purpose of ["signup", "login"] as const) {
      const { html } = composeOtpEmail(purpose, CODE);
      // The shell's bulletproof button is a `class="btn"` cell wrapping a padded
      // anchor. Neither may appear: the recipient types the code into the tab
      // they already have open, so there is no honest target to send them to.
      expect(html).not.toContain('class="btn"');
      expect(html).not.toContain("padding:15px 34px");
    }
  });

  it("sends the signup code with no link to click at all", () => {
    // Nothing in the signup path needs a URL, and the fewer links a "here is
    // your code" email carries the less it resembles the phishing version.
    expect(composeOtpEmail("signup", CODE).text).not.toContain("http");
  });

  it("gives the sign-in code one link, and it reports rather than signs in", () => {
    const { text } = composeOtpEmail("login", CODE);
    // "If that wasn't you" is useless without somewhere to say so — but the
    // destination must be a report page, never anything that completes a login.
    expect(text).toContain("Report this sign-in: https://");
    expect(text).toContain("/contact");
    expect(text.match(/https:\/\//g)?.length).toBe(1);
    expect(text).not.toContain("/login");
  });

  it("adds no unsubscribe link to a security email", () => {
    for (const purpose of ["signup", "login"] as const) {
      const { html, text } = composeOtpEmail(purpose, CODE);
      expect(html).not.toContain("Unsubscribe");
      expect(text).not.toContain("Unsubscribe");
    }
  });
});

describe("composeOtpEmail — the two purposes stay distinct", () => {
  it("gives each purpose its own subject, heading and body", () => {
    const signup = composeOtpEmail("signup", CODE);
    const login = composeOtpEmail("login", CODE);
    expect(signup.subject).not.toBe(login.subject);
    expect(signup.html).not.toBe(login.html);
    expect(signup.text).not.toBe(login.text);
  });

  it("says what each code is actually for", () => {
    const signup = composeOtpEmail("signup", CODE);
    const login = composeOtpEmail("login", CODE);
    // Signup verifies an address before any account exists; login vouches for
    // an unrecognised device on an account that already does.
    expect(signup.text).toContain("signup page");
    expect(signup.text.toLowerCase()).toContain("workspace");
    expect(login.text).toContain("sign-in page");
    expect(login.text.toLowerCase()).toContain("don't recognise");
  });

  it("explains what to do when it wasn't you, differently for each", () => {
    expect(composeOtpEmail("signup", CODE).text.toLowerCase()).toContain("ignore this email");
    // The sign-in case can't be shrugged off the same way — the password is out.
    expect(composeOtpEmail("login", CODE).text.toLowerCase()).toContain("password");
  });
});

describe("composeOtpEmail — branded shell", () => {
  it("renders through the shared template rather than a bare div", () => {
    const { html } = composeOtpEmail("signup", CODE);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("/brand/talko-logo.png");   // logo, so it reads as ours
    expect(html).toContain('name="color-scheme"');      // dark-mode aware
  });

  it("hides the code-bearing preheader from the visible body", () => {
    const { html } = composeOtpEmail("login", CODE);
    // The preview line exists so the code can be read from a notification; if
    // the hiding ever broke it would render as duplicate digits above the panel.
    const i = html.indexOf(`${CODE} is your Talko AI code`);
    expect(i).toBeGreaterThan(-1);
    expect(html.slice(Math.max(0, i - 220), i)).toContain("display:none");
  });

  it("gives every email a footer reason, since it carries no unsubscribe", () => {
    for (const purpose of ["signup", "login"] as const) {
      const { text } = composeOtpEmail(purpose, CODE);
      expect(text).toContain("You're getting this because");
      expect(text).toContain("unsubscribe from");
    }
  });
});
