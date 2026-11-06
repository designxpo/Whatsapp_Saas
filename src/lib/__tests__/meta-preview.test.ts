// Meta's ad-preview HTML is rendered by rebuilding the Facebook iframe from its
// src — never by putting the HTML itself into the portal's origin.
import { describe, it, expect } from "vitest";
import { metaPreviewFrame, safeMetaPreviewUrl } from "../meta-preview";

const REAL = '<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=AQKx&amp;t=AQLy" width="540" height="690" scrolling="yes" style="border: none;"></iframe>';

describe("metaPreviewFrame", () => {
  it("pulls the Facebook src (entities decoded) and the size out of a real preview", () => {
    expect(metaPreviewFrame(REAL)).toEqual({
      src: "https://www.facebook.com/ads/api/preview_iframe.php?d=AQKx&t=AQLy", width: 540, height: 690,
    });
  });

  it("accepts single quotes and missing sizes", () => {
    expect(metaPreviewFrame("<IFRAME SRC='https://business.facebook.com/x'></IFRAME>"))
      .toEqual({ src: "https://business.facebook.com/x", width: null, height: null });
  });

  it("refuses anything that is not an https Facebook URL", () => {
    for (const html of [
      '<iframe src="javascript:alert(1)"></iframe>',
      '<iframe src="http://www.facebook.com/ads/api/preview_iframe.php"></iframe>',
      '<iframe src="https://facebook.com.evil.example/x"></iframe>',
      '<iframe src="https://evilfacebook.com/x"></iframe>',
      '<iframe src="https://user@www.facebook.com/x"></iframe>',
      '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>',
      '<img src=x onerror=alert(1)>',
      "",
    ]) {
      expect(metaPreviewFrame(html), html).toBeNull();
    }
  });

  it("knows fb.com as Facebook's", () => {
    expect(safeMetaPreviewUrl("https://www.fb.com/p")).toBe("https://www.fb.com/p");
    expect(safeMetaPreviewUrl(null)).toBeNull();
  });
});
