import { NextResponse } from "next/server";
import { AFFILIATE_SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.delete(AFFILIATE_SESSION_COOKIE);
  return res;
}
