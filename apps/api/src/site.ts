import { existsSync, readFileSync, watchFile, writeFileSync } from "node:fs";
import YAML from "yaml";
import { z } from "zod";
import { config } from "./config.js";

const textPairSchema = z.object({
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(240)
});

const mediaUrlSchema = z.string().min(1).max(1000);

export const siteSettingsSchema = z.object({
  brand: z.object({
    name: z.string().min(1).max(40),
    systemText: z.string().min(1).max(80),
    adminName: z.string().min(1).max(60)
  }),
  media: z.object({
    homeHeroImage: mediaUrlSchema,
    homeInsetImage: mediaUrlSchema,
    entryHeroImage: mediaUrlSchema
  }),
  home: z.object({
    eyebrow: z.string().min(1).max(40),
    title: z.string().min(1).max(80),
    subtitle: z.string().min(1).max(240),
    loadingHint: z.string().min(1).max(160),
    entryListTitle: z.string().min(1).max(60),
    entryCardHint: z.string().min(1).max(80),
    flowSteps: z.array(z.string().min(1).max(40)).length(3),
    highlights: z.array(textPairSchema).length(2),
    metrics: z.array(z.string().min(1).max(80)).length(3)
  }),
  entry: z.object({
    eyebrow: z.string().min(1).max(40),
    fallbackTitle: z.string().min(1).max(80),
    fallbackSubtitle: z.string().min(1).max(240),
    loadingHint: z.string().min(1).max(160),
    bindingTitle: z.string().min(1).max(80),
    bindingExplain: z.string().min(1).max(240),
    startButton: z.string().min(1).max(40),
    flowSteps: z.array(z.string().min(1).max(40)).length(3),
    warning: textPairSchema,
    bindingNote: textPairSchema,
    confirmAvatar: z.string().min(1).max(200),
    confirmPrivacy: z.string().min(1).max(220)
  }),
  session: z.object({
    eyebrow: z.string().min(1).max(40),
    subtitle: z.string().min(1).max(240),
    loadingHint: z.string().min(1).max(160),
    lostTitle: z.string().min(1).max(80),
    lostSubtitle: z.string().min(1).max(200),
    lostBackLabel: z.string().min(1).max(40),
    navTitle: z.string().min(1).max(40),
    submitHint: z.string().min(1).max(160),
    submitButton: z.string().min(1).max(40),
    fullscreenTitle: z.string().min(1).max(80),
    fullscreenBody: z.string().min(1).max(220),
    fullscreenButton: z.string().min(1).max(40),
    resumeButton: z.string().min(1).max(40)
  }),
  result: z.object({
    eyebrow: z.string().min(1).max(40),
    passTitle: z.string().min(1).max(60),
    failTitle: z.string().min(1).max(60),
    passSubtitle: z.string().min(1).max(220),
    failSubtitle: z.string().min(1).max(220),
    copyButton: z.string().min(1).max(40),
    copiedButton: z.string().min(1).max(40),
    homeButton: z.string().min(1).max(40),
    retryButton: z.string().min(1).max(40),
    reviewTitle: z.string().min(1).max(40),
    noWrongTitle: z.string().min(1).max(40),
    noWrongBody: z.string().min(1).max(200)
  }),
  admin: z.object({
    eyebrow: z.string().min(1).max(40),
    title: z.string().min(1).max(80),
    subtitle: z.string().min(1).max(240),
    loginTitle: z.string().min(1).max(60),
    loginSubtitle: z.string().min(1).max(240),
    loginButton: z.string().min(1).max(40),
    logoutButton: z.string().min(1).max(40),
    siteSettingsTitle: z.string().min(1).max(40),
    siteSettingsNote: z.string().min(1).max(200)
  })
});

export type SiteSettings = z.infer<typeof siteSettingsSchema>;

let siteSettings: SiteSettings | null = null;

export function parseSiteSettingsYaml(sourceYaml: string) {
  return siteSettingsSchema.parse(YAML.parse(sourceYaml));
}

export function getSiteSettings() {
  return siteSettings;
}

export function syncSiteSettingsFromFile() {
  if (!existsSync(config.siteSettingsFile)) {
    return null;
  }

  const sourceYaml = readFileSync(config.siteSettingsFile, "utf8");
  const parsed = parseSiteSettingsYaml(sourceYaml);
  siteSettings = parsed;
  return siteSettings;
}

export function writeSiteSettingsYaml(sourceYaml: string) {
  const parsed = parseSiteSettingsYaml(sourceYaml);
  writeFileSync(config.siteSettingsFile, sourceYaml, "utf8");
  siteSettings = parsed;
  return siteSettings;
}

export function readSiteSettingsYaml() {
  if (!existsSync(config.siteSettingsFile)) {
    return null;
  }

  return readFileSync(config.siteSettingsFile, "utf8");
}

export function watchSiteSettingsFile(
  handlers?: {
    onReload?: () => void;
    onError?: (error: Error) => void;
  }
) {
  if (!existsSync(config.siteSettingsFile)) {
    return;
  }

  watchFile(config.siteSettingsFile, { interval: 600 }, () => {
    try {
      syncSiteSettingsFromFile();
      handlers?.onReload?.();
    } catch (error) {
      handlers?.onError?.(error instanceof Error ? error : new Error("site_settings_reload_failed"));
    }
  });
}
