import { z } from "zod";

/**
 * Platform configuration edited by Super Admin. Stored as key/value rows in
 * `platform_settings`; missing keys fall back to these defaults.
 */
export const platformSettingsSchema = z.object({
  trialDays: z.number().int().min(0).max(365),
  graceDays: z.number().int().min(0).max(90),
  trialPlanKey: z.string().min(1),
  trialReminderDays: z.array(z.number().int().min(1).max(365)).max(10),
  restrictedMode: z.enum(["READ_ONLY", "NONE"]),
  defaultCurrency: z.string().length(3),
  productName: z.string().min(1).max(60),
  supportEmail: z.email(),
  signupsEnabled: z.boolean(),
  fairUseMaxWorkspaces: z.number().int().min(1).max(1000),
  workspaceCreatesPerDay: z.number().int().min(1).max(100),
  maintenanceMode: z.boolean(),
});

export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
export type PlatformSettingKey = keyof PlatformSettings;

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  trialDays: 15,
  graceDays: 7,
  trialPlanKey: "pro",
  trialReminderDays: [7, 12, 14],
  restrictedMode: "READ_ONLY",
  defaultCurrency: "INR",
  productName: "RestaurantOS",
  supportEmail: "support@restaurantos.local",
  signupsEnabled: true,
  fairUseMaxWorkspaces: 25,
  workspaceCreatesPerDay: 5,
  maintenanceMode: false,
};

/** Merge stored rows over defaults, ignoring invalid stored values. */
export function mergePlatformSettings(rows: { key: string; value: unknown }[]): PlatformSettings {
  const merged: Record<string, unknown> = { ...DEFAULT_PLATFORM_SETTINGS };
  const shape = platformSettingsSchema.shape;
  for (const row of rows) {
    if (!(row.key in shape)) continue;
    const field = shape[row.key as PlatformSettingKey];
    const parsed = field.safeParse(row.value);
    if (parsed.success) merged[row.key] = parsed.data;
  }
  return merged as PlatformSettings;
}
