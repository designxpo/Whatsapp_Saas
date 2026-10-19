// The export has one job: produce an archive that a real tar can open.
//
// An export nobody can extract is worse than none, because it looks like a way
// out of the format right up until somebody needs it. So these tests unpack
// the bytes rather than trusting the writer — the checksum in particular is
// the field every hand-written tar gets wrong, and a wrong one is only
// discovered by the person depending on the file.
import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import { tarGz } from "@/lib/okfbundle";

const BLOCK = 512;

/** A minimal reader: just enough to prove the writer is honest. */
function untar(buf: Buffer): { path: string; contents: string; checksumOk: boolean }[] {
  const out: { path: string; contents: string; checksumOk: boolean }[] = [];
  let off = 0;
  while (off + BLOCK <= buf.length) {
    const header = buf.subarray(off, off + BLOCK);
    const path = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (!path) break;                                   // terminator blocks
    const size = parseInt(header.subarray(124, 136).toString("utf8").trim(), 8) || 0;

    // Recompute the checksum with its own field read as spaces, as the format
    // specifies.
    const stated = parseInt(header.subarray(148, 156).toString("utf8").replace(/\0/g, " ").trim(), 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += (i >= 148 && i < 156) ? 0x20 : header[i];

    const start = off + BLOCK;
    out.push({
      path,
      contents: buf.subarray(start, start + size).toString("utf8"),
      checksumOk: sum === stated,
    });
    off = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}

const read = (b: Buffer) => untar(gunzipSync(b));

describe("the archive is a real tar", () => {
  const files = [
    { path: "index.md", contents: "# Knowledge library\n\n2 concepts.\n" },
    { path: "pricing/tuition-and-emi.md", contents: "---\ntype: policy\n---\n\nThe fee is ₹85,000.\n" },
  ];

  it("round-trips every file, byte for byte", () => {
    const got = read(tarGz(files));
    expect(got.map(f => f.path)).toEqual(["index.md", "pricing/tuition-and-emi.md"]);
    expect(got[1].contents).toBe(files[1].contents);
  });

  it("writes a checksum that validates — the field every hand-rolled tar breaks", () => {
    for (const f of read(tarGz(files))) expect(f.checksumOk, f.path).toBe(true);
  });

  it("gets the length right for multi-byte characters", () => {
    // "₹" is three bytes. Sizing the header from string length rather than
    // byte length truncates the file, and only for the records that mention
    // money — which is most of them.
    const got = read(tarGz([{ path: "a.md", contents: "₹₹₹ fee" }]));
    expect(got[0].contents).toBe("₹₹₹ fee");
  });

  it("keeps directory paths intact", () => {
    expect(read(tarGz(files))[1].path).toBe("pricing/tuition-and-emi.md");
  });

  it("terminates the archive, so a reader knows where it ends", () => {
    const raw = gunzipSync(tarGz(files));
    expect(raw.subarray(raw.length - BLOCK * 2).every(b => b === 0)).toBe(true);
  });

  it("produces identical bytes for identical input", () => {
    // A timestamp in the header would make every export look like a change to
    // anything diffing or caching them.
    expect(tarGz(files).equals(tarGz(files))).toBe(true);
  });

  it("refuses a path too long to store, rather than truncating it silently", () => {
    expect(() => tarGz([{ path: "x/".repeat(60) + "a.md", contents: "hi" }])).toThrow(/too long/i);
  });

  it("handles a file whose length is an exact block multiple", () => {
    // The classic off-by-one: padding of a full block instead of none.
    const got = read(tarGz([{ path: "a.md", contents: "x".repeat(BLOCK) }]));
    expect(got[0].contents.length).toBe(BLOCK);
    expect(got).toHaveLength(1);
  });

  it("handles an empty file without losing the entry", () => {
    const got = read(tarGz([{ path: "empty.md", contents: "" }, { path: "b.md", contents: "hi" }]));
    expect(got.map(f => f.path)).toEqual(["empty.md", "b.md"]);
  });
});

describe("the archive cannot write outside where it is extracted", () => {
  // An export is a file somebody else unpacks, possibly on a machine nobody
  // here controls. conceptSlug flattens separators so nothing reaching this
  // today is dangerous — but the writer is the boundary that produces the
  // artifact, and it is the last layer that can still refuse.
  it("refuses a parent-directory escape", () => {
    expect(() => tarGz([{ path: "../../etc/passwd", contents: "x" }])).toThrow(/unsafe path/i);
  });

  it("refuses an absolute path", () => {
    expect(() => tarGz([{ path: "/etc/passwd", contents: "x" }])).toThrow(/unsafe path/i);
  });

  it("refuses a null byte, which truncates the name in some readers", () => {
    expect(() => tarGz([{ path: "ok.md\u0000../../x", contents: "x" }])).toThrow(/unsafe path/i);
  });

  it("still accepts an ordinary nested concept path", () => {
    expect(() => tarGz([{ path: "pricing/tuition-and-emi.md", contents: "x" }])).not.toThrow();
  });

  it("allows a dot inside a name, which is not a traversal", () => {
    expect(() => tarGz([{ path: "pricing/adv.cert.md", contents: "x" }])).not.toThrow();
  });
});
