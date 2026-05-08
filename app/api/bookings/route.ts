import { listBookings } from "@/lib/bookings";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const bookings = await listBookings();

    return NextResponse.json({ bookings });
  } catch (error: unknown) {
    console.error("Bookings API error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load bookings";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
