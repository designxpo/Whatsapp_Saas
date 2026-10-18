// The bucket is public. Whatever gets in here is world-readable with no
// session, so these tests are about what must never get in.
import { describe, it, expect } from "vitest";
import { uploadProblem, safeStorageName, storedContentType, inertContentType } from "../uploadguard";

const MB = 1024 * 1024;
const file = (type: string, size = 1024, name = "thing") => ({ type, size, name });

describe("what may be stored", () => {
  it("accepts the types the composer actually offers", () => {
    // These are the accept= lists on the real file inputs. If this list ever
    // shrinks below them, a working upload button starts returning 400.
    for (const t of [
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "video/mp4", "video/3gpp", "video/quicktime",
      "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain", "text/csv",
    ]) {
      expect(uploadProblem(file(t)), t).toBeNull();
    }
  });

  it("refuses SVG, and says why and what to do instead", () => {
    // The finding this whole module exists for: an SVG is an image in a file
    // picker and a script host everywhere else.
    const why = uploadProblem(file("image/svg+xml"));
    expect(why).toMatch(/script/i);
    expect(why).toMatch(/PNG/);
  });

  it("refuses HTML even when it is dressed as something else", () => {
    expect(uploadProblem(file("text/html"))).not.toBeNull();
    expect(uploadProblem(file("application/xhtml+xml"))).not.toBeNull();
    // An .html with a lying extension still has to declare a type, and the
    // type is what decides.
    expect(uploadProblem(file("text/html", 1024, "report.pdf"))).not.toBeNull();
  });

  it("refuses executables and archives", () => {
    for (const t of ["application/x-msdownload", "application/zip", "application/x-sh"]) {
      expect(uploadProblem(file(t)), t).not.toBeNull();
    }
  });

  it("is not fooled by charset parameters or capitals", () => {
    expect(uploadProblem(file("IMAGE/PNG"))).toBeNull();
    expect(uploadProblem(file("image/png; charset=binary"))).toBeNull();
    expect(uploadProblem(file("IMAGE/SVG+XML"))).not.toBeNull();
  });

  it("refuses a file with no type at all rather than waving it through", () => {
    expect(uploadProblem(file(""))).not.toBeNull();
  });
});

describe("size", () => {
  it("caps each kind at what WhatsApp will actually deliver", () => {
    expect(uploadProblem(file("image/png", 4 * MB))).toBeNull();
    expect(uploadProblem(file("image/png", 6 * MB))).toMatch(/5MB/);

    expect(uploadProblem(file("video/mp4", 15 * MB))).toBeNull();
    expect(uploadProblem(file("video/mp4", 20 * MB))).toMatch(/16MB/);

    // A document gets the larger allowance — the same 20MB that was too big
    // for a video is fine as a PDF.
    expect(uploadProblem(file("application/pdf", 20 * MB))).toBeNull();
    expect(uploadProblem(file("application/pdf", 30 * MB))).toMatch(/25MB/);
  });

  it("says how big the file actually was, not just that it was too big", () => {
    expect(uploadProblem(file("image/png", 31 * MB))).toMatch(/31MB/);
  });

  it("refuses an empty file", () => {
    expect(uploadProblem(file("image/png", 0))).toMatch(/empty/);
    expect(uploadProblem(file("image/png", NaN))).toMatch(/empty/);
  });
});

describe("the stored name", () => {
  it("keeps a recognisable name, because the recipient sees it", () => {
    // A document sent over WhatsApp is shown by its filename. Replacing it
    // with a random string makes a real brochure look like spam.
    expect(safeStorageName("Q3-brochure.pdf", "application/pdf")).toMatch(/_Q3-brochure\.pdf$/);
  });

  it("cannot climb out of the bucket", () => {
    for (const evil of ["../../secrets.pdf", "..\\..\\secrets.pdf", "/etc/passwd.pdf", "a/b/c.pdf"]) {
      const out = safeStorageName(evil, "application/pdf");
      expect(out, evil).not.toContain("/");
      expect(out, evil).not.toContain("\\");
      expect(out, evil).not.toContain("..");
    }
  });

  it("forces the extension to match the type we accepted", () => {
    // "report.pdf.html" declared as a PDF is stored as a .pdf. The double
    // extension is how a file gets served as one thing and opened as another.
    expect(safeStorageName("report.pdf.html", "application/pdf")).toMatch(/\.pdf$/);
    expect(safeStorageName("photo.php", "image/png")).toMatch(/\.png$/);
  });

  it("strips control characters and never produces a hidden file", () => {
    expect(safeStorageName("bad\u0000name\u001f.png", "image/png")).toMatch(/^\d+_badname\.png$/);
    expect(safeStorageName(".htaccess", "text/plain")).not.toMatch(/_\./);
  });

  it("still produces a usable name when there is nothing left of the original", () => {
    expect(safeStorageName("...", "image/png")).toMatch(/^\d+_file\.png$/);
    expect(safeStorageName("", "image/png")).toMatch(/^\d+_file\.png$/);
  });

  it("bounds the length", () => {
    expect(safeStorageName("x".repeat(500) + ".png", "image/png").length).toBeLessThan(120);
  });
});

describe("the type it is served with", () => {
  it("serves our type, never the client's string", () => {
    expect(storedContentType("image/png; charset=binary")).toBe("image/png");
    // Anything not on the list can still reach here through a caller that
    // skipped the check — it must not be served as itself.
    expect(storedContentType("image/svg+xml")).toBe("application/octet-stream");
    expect(storedContentType("text/html")).toBe("application/octet-stream");
  });
});

describe("inbound media, which we cannot refuse", () => {
  it("downgrades anything a browser would execute", () => {
    // A customer can send an .svg or .html as a WhatsApp document. Dropping it
    // would lose the customer's attachment, so it is stored as bytes instead.
    for (const t of ["image/svg+xml", "text/html", "application/xhtml+xml", "text/xml", "application/xml"]) {
      expect(inertContentType(t), t).toBe("application/octet-stream");
    }
  });

  it("leaves real media alone so it still previews and plays", () => {
    expect(inertContentType("image/jpeg")).toBe("image/jpeg");
    expect(inertContentType("video/mp4")).toBe("video/mp4");
    expect(inertContentType("audio/ogg")).toBe("audio/ogg");
    // Types we do not accept from a file picker are still fine to STORE from
    // an inbound message — the point is only that they must not execute.
    expect(inertContentType("application/zip")).toBe("application/zip");
  });

  it("handles a missing or malformed type", () => {
    expect(inertContentType("")).toBe("application/octet-stream");
    expect(inertContentType("IMAGE/SVG+XML; q=1")).toBe("application/octet-stream");
  });
});
