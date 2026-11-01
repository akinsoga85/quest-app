// Design tokens, copied from the Figma file's "Color" variables (hf/* and zone/*)
// and the hi-fi screens' type and spacing. Figma is the source of truth: when a
// variable changes there, change it here and run `npm test` (contrast checks).

export const colors = {
  bg: "#0F0F11",
  surface: "#18181C",
  surface2: "#24242A",
  border: "#2A2A31",
  text: "#F4F3EE",
  text2: "#C9C8CF",
  muted: "#9A99A3",
  lime: "#D4FF3A",
  limeInk: "#0F0F11",
  limeTint: "#20231A",
  danger: "#FF6B6B",
  white: "#FFFFFF",
  black: "#000000",
} as const;

export const zoneColors = {
  photography: "#8EBBFF",
  fashion: "#FF9FCF",
  art_crafts: "#FFAD6B",
  music: "#B9A0FF",
  words: "#63E2C6",
} as const;

export type ColorToken = keyof typeof colors;

// Font family names as registered by @expo-google-fonts.
export const fonts = {
  display: "BricolageGrotesque_800ExtraBold",
  displayBold: "BricolageGrotesque_700Bold",
  body: "Inter_400Regular",
  bodySemi: "Inter_600SemiBold",
  bodyBold: "Inter_700Bold",
} as const;

// Sizes in points. Nothing goes below 11 (Design review: platform design).
export const type = {
  screenTitle: { font: fonts.display, size: 42, lineHeight: 44, letterSpacing: -0.8 },
  title: { font: fonts.display, size: 30, lineHeight: 33, letterSpacing: -0.5 },
  heading: { font: fonts.displayBold, size: 22, lineHeight: 27 },
  subheading: { font: fonts.displayBold, size: 18, lineHeight: 23 },
  body: { font: fonts.body, size: 15, lineHeight: 22 },
  bodySmall: { font: fonts.body, size: 14, lineHeight: 20 },
  label: { font: fonts.bodySemi, size: 15, lineHeight: 20 },
  button: { font: fonts.bodySemi, size: 16, lineHeight: 20 },
  caption: { font: fonts.body, size: 13, lineHeight: 18 },
  eyebrow: { font: fonts.bodySemi, size: 12, lineHeight: 16, letterSpacing: 0.7 },
  micro: { font: fonts.bodySemi, size: 11, lineHeight: 14 },
} as const;

export type TypeToken = keyof typeof type;

export const MIN_FONT_SIZE = 11;

export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  screenTop: 56,
  screenSide: 16,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  card: 18,
  sheet: 32,
  screen: 40,
  pill: 999,
} as const;

// Apple's minimum tap target is 44 pt; Material's is 48 dp.
export const touch = {
  minIOS: 44,
  minAndroid: 48,
  buttonHeight: 54,
} as const;

export function minTouch(platform: "ios" | "android" | string): number {
  return platform === "android" ? touch.minAndroid : touch.minIOS;
}

// WCAG 2.1 contrast ratio between two hex colours.
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.replace("#", ""), 16);
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
