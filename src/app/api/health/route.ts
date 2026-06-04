import { NextResponse } from "next/server";

// Health endpoint hostlet polls. Any 2xx/3xx is considered healthy.
export function GET() {
  return NextResponse.json({ ok: true });
}
