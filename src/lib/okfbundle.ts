import { DEFAULT_TENANT_ID } from "./tenant";
// Exporting the library as an OKF bundle.
//
// The spec says a bundle may be a tarball, a Git repository or a mounted
// filesystem — plain Markdown either way, with no SDK between the agent and
// the files. The tarball is what matters here: it is the proof that the
// knowledge can leave. A format nobody can walk out of the door with is a
// database with extra steps, whatever its documentation claims.
//
// ── Why tar is written by hand ──────────────────────────────────────────────
//
// There is no tar dependency in this project and adding one for ~70 lines of a
// fifty-year-old format is a poor trade: a general archiver brings symlinks,
// sparse files, long-name extensions and permission semantics, none of which a
// directory of Markdown uses, and each of which is a way for an export to
// differ from what was in the database. gzip comes from node:zlib, which is
// built in.
import { gzipSync } from "node:zlib";
import { serialiseConcept, buildIndexes, type OkfConcept } from "./okf";
import { listActiveConcepts } from "./kbconcepts";

const BLOCK = 512;

/** One ustar header + padded body. */
function tarEntry(path: string, contents: string): Buffer {
  const body = Buffer.from(contents, "utf8");
  const header = Buffer.alloc(BLOCK);

  // An archive is a file somebody else extracts, so the entry name is refused
  // here rather than trusted. conceptSlug already flattens separators and the
  // only paths reaching this today are built from it — but this is the
  // boundary that produces the artifact, and a traversal entry written now
  // would be executed on a machine nobody here controls. Checked at the layer
  // that can still say no.
  if (path.startsWith("/") || path.split("/").includes("..") || path.includes("\0")) {
    throw new Error(`unsafe path for tar: ${path}`);
  }

  // ustar splits a long path across name[100] and prefix[155]. Concept paths
  // are "area/slug.md" and nowhere near that, but a silent truncation would
  // produce an archive that extracts to the wrong filename, so it is refused.
  const name = Buffer.from(path, "utf8");
  if (name.length > 100) throw new Error(`path too long for tar: ${path}`);
  name.copy(header, 0);

  header.write("000644 \0", 100, "utf8");      // mode
  header.write("000000 \0", 108, "utf8");      // uid
  header.write("000000 \0", 116, "utf8");      // gid
  header.write(body.length.toString(8).padStart(11, "0") + " ", 124, "utf8");
  // A fixed mtime, so exporting the same library twice gives byte-identical
  // archives. A timestamp here would make every export look like a change to
  // anything diffing or caching them.
  header.write((0).toString(8).padStart(11, "0") + " ", 136, "utf8");
  header.write("        ", 148, "utf8");       // checksum placeholder: spaces
  header.write("0", 156, "utf8");              // type: regular file
  header.write("ustar\0", 257, "utf8");
  header.write("00", 263, "utf8");

  // Checksum is the sum of every header byte with the checksum field read as
  // spaces — which is why it is written last, over the placeholder.
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "utf8");

  const pad = (BLOCK - (body.length % BLOCK)) % BLOCK;
  return Buffer.concat([header, body, Buffer.alloc(pad)]);
}

/** A gzipped tar of these files. */
export function tarGz(files: { path: string; contents: string }[]): Buffer {
  const entries = files.map(f => tarEntry(f.path, f.contents));
  // Two zero blocks terminate the archive.
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(BLOCK * 2)]));
}

/**
 * The files an OKF bundle contains: every live concept, plus the indexes an
 * agent reads to navigate them.
 *
 * Only active concepts. A bundle carrying pending ones would hand whoever
 * imports it the quarantined answers as though they were published, which is
 * the one thing the status model exists to prevent — and the recipient has no
 * way of knowing.
 */
export async function bundleFiles(tenantId = DEFAULT_TENANT_ID): Promise<{ path: string; contents: string }[]> {
  const stored = await listActiveConcepts(undefined, tenantId);
  const concepts: OkfConcept[] = stored.map(c => ({
    path: c.path,
    type: c.type,
    title: c.title ?? undefined,
    description: c.description ?? undefined,
    tags: c.tags.length ? c.tags : undefined,
    extra: c.sources.length ? { sources: c.sources.join(", ") } : undefined,
    body: c.body,
  }));

  const { root, areas } = buildIndexes("Knowledge library", concepts);
  return [
    { path: "index.md", contents: root },
    ...Object.entries(areas).map(([path, contents]) => ({ path, contents })),
    ...concepts.map(c => ({ path: c.path, contents: serialiseConcept(c) })),
  ];
}

/** The whole library as one downloadable .tar.gz. */
export async function exportBundle(tenantId = DEFAULT_TENANT_ID): Promise<Buffer> {
  return tarGz(await bundleFiles(tenantId));
}
