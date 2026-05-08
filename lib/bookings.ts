import { getPool } from "./db";

export type BookingInput = {
  fullName: string;
  phone: string;
  bookingDate: string;
  bookingTime: string;
  skillLevel: string;
  bootSize: string;
};

export type BookingRecord = {
  id: number;
  fullName: string;
  phone: string;
  bookingDate: string;
  bookingTime: string;
  skillLevel: string;
  bootSize: string;
  status: string;
  source: string;
  createdAt: string;
};

type BookingRow = {
  id: number;
  full_name: string;
  phone: string;
  booking_date: string;
  booking_time: string;
  skill_level: string;
  boot_size: string;
  status: string;
  source: string;
  created_at: Date;
};

function mapBookingRow(row: BookingRow): BookingRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    bookingDate: row.booking_date,
    bookingTime: row.booking_time,
    skillLevel: row.skill_level,
    bootSize: row.boot_size,
    status: row.status,
    source: row.source,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createBooking(booking: BookingInput) {
  const result = await getPool().query<BookingRow>(
    `
      INSERT INTO bookings (
        full_name,
        phone,
        booking_date,
        booking_time,
        skill_level,
        boot_size,
        raw_booking
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING
        id,
        full_name,
        phone,
        booking_date,
        booking_time,
        skill_level,
        boot_size,
        status,
        source,
        created_at
    `,
    [
      booking.fullName,
      booking.phone,
      booking.bookingDate,
      booking.bookingTime,
      booking.skillLevel,
      booking.bootSize,
      JSON.stringify(booking),
    ]
  );

  return mapBookingRow(result.rows[0]);
}

export async function listBookings() {
  const result = await getPool().query<BookingRow>(
    `
      SELECT
        id,
        full_name,
        phone,
        booking_date,
        booking_time,
        skill_level,
        boot_size,
        status,
        source,
        created_at
      FROM bookings
      ORDER BY created_at DESC
      LIMIT 100
    `
  );

  return result.rows.map(mapBookingRow);
}
