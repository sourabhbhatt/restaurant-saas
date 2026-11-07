import { z } from "zod";

import type { SessionStatus, TableStatus } from "@ros/domain/tables/table-status";

export const MAX_BULK_TABLES = 100;

const name = z.string().trim().min(1, "Enter a table name").max(30, "Use at most 30 characters");
const capacity = z
  .number({ message: "Enter the number of seats" })
  .int("Use a whole number")
  .min(1, "At least 1 seat")
  .max(100, "At most 100 seats");
const section = z
  .string()
  .trim()
  .max(40, "Use at most 40 characters")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const createTableSchema = z.object({
  name,
  capacity,
  section,
  isActive: z.boolean().optional(),
});
export type CreateTableInput = z.input<typeof createTableSchema>;

export const updateTableSchema = z.object({
  name: name.optional(),
  capacity: capacity.optional(),
  section,
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  version: z.number().int().positive().optional(),
});
export type UpdateTableInput = z.input<typeof updateTableSchema>;

/** Bulk create e.g. prefix "T", from 1, to 10 → T1..T10. */
export const bulkCreateTablesSchema = z
  .object({
    prefix: z.string().trim().max(20, "Use at most 20 characters"),
    from: z.number({ message: "Enter a number" }).int().min(0, "Cannot be negative").max(9999),
    to: z.number({ message: "Enter a number" }).int().min(0, "Cannot be negative").max(9999),
    capacity,
    section,
  })
  .superRefine((v, ctx) => {
    if (v.to < v.from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "Must be at least the start number" });
    } else if (v.to - v.from + 1 > MAX_BULK_TABLES) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `Create at most ${MAX_BULK_TABLES} tables at once`,
      });
    }
  });
export type BulkCreateTablesInput = z.input<typeof bulkCreateTablesSchema>;

export function bulkTableNames(input: { prefix: string; from: number; to: number }): string[] {
  const names: string[] = [];
  for (let n = input.from; n <= input.to; n++) names.push(`${input.prefix.trim()}${n}`);
  return names;
}

export interface TableDto {
  id: string;
  branchId: string;
  name: string;
  capacity: number;
  section: string | null;
  isActive: boolean;
  sortOrder: number;
  version: number;
  /** Derived from the open session and its live bill (deriveTableStatus). */
  status: TableStatus;
  session: { id: string; status: SessionStatus; openedAt: string } | null;
  qr: { active: boolean; createdAt: string | null };
  createdAt: string;
}

export interface TableQrDto {
  tableId: string;
  tableName: string;
  url: string;
  svg: string;
  createdAt: string;
}

/** For the printable QR sheet. */
export interface QrSheetDto {
  restaurantName: string;
  branchName: string;
  tables: TableQrDto[];
  /** Tables without an active QR (not printed). */
  missing: { id: string; name: string }[];
}
