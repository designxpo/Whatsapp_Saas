import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId } from "@/lib/auth";
import { fetchStoreProducts, KIND_LABELS } from "@/lib/integrations";
import { importProducts } from "@/lib/commerce";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST — pull a store integration's catalog into wa_products (one-way, idempotent).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const { kind, products } = await fetchStoreProducts(id, tid);
    const { imported, updated } = await importProducts(products, kind, tid);
    return NextResponse.json({
      success: true, imported, updated, total: products.length,
      message: products.length
        ? `Imported ${imported} new and updated ${updated} product${imported + updated === 1 ? "" : "s"} from ${KIND_LABELS[kind]}.`
        : `${KIND_LABELS[kind]} returned no products to import.`,
    });
  } catch (err) {
    const m = errorMessage(err);
    if (/Not a store/i.test(m)) return NextResponse.json({ error: "This integration can't import products." }, { status: 400 });
    return NextResponse.json({ error: "Couldn't import the catalog — open this integration and hit Test to check the connection." }, { status: 502 });
  }
}
