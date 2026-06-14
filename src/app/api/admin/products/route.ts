import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser } from "@/lib/auth";
import { listProducts, saveProduct, deleteProduct, type Product } from "@/lib/commerce";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try { return NextResponse.json({ products: await listProducts() }); }
  catch (err) { return NextResponse.json({ products: [], error: errorMessage(err) }); }
}

export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: Partial<Product> & { name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim()) return NextResponse.json({ error: "Product name is required" }, { status: 400 });
  try {
    const p = await saveProduct({ ...body, name: body.name! });
    logActivity(await currentUser(), "product.save", p.name);
    return NextResponse.json({ success: true, product: p });
  } catch (err) { return NextResponse.json({ error: `${errorMessage(err)} — make sure migration 0020 is applied` }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try { await deleteProduct(body.id); return NextResponse.json({ success: true }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
