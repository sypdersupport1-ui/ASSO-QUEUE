export interface CustomerThemeSurfaces {
  background: string;
  backgroundElevated: string;
  surface: string;
  surfaceSolid: string;
  surfaceElevated: string;
  surfaceInteractive: string;
}

export interface CustomerThemeAccents {
  primary: string;
  primaryHover: string;
  primaryForeground: string;
  primaryGlow: string;
  accentDineIn: string;
  accentDineInGlow: string;
  accentTakeaway: string;
  accentTakeawayGlow: string;
}

export interface CustomerThemeText {
  text: string;
  textSecondary: string;
  textMuted: string;
}

export interface CustomerThemeBorders {
  border: string;
  borderSubtle: string;
  borderHover: string;
  borderActive: string;
}

export interface CustomerThemeStatus {
  success: string;
  warning: string;
  danger: string;
}

export interface CustomerThemeGeometry {
  radiusSm: string;
  radiusMd: string;
  radiusLg: string;
  radiusXl: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
}

export interface CustomerThemeTokens {
  surfaces: CustomerThemeSurfaces;
  accents: CustomerThemeAccents;
  text: CustomerThemeText;
  borders: CustomerThemeBorders;
  status: CustomerThemeStatus;
  geometry: CustomerThemeGeometry;
}

export interface CustomerThemeMetadata {
  category?: 'core' | 'cultural' | 'seasonal' | 'modern';
  season?: string;
  tags?: string[];
  previewAccentColor?: string;
  previewSurfaceColor?: string;
}

export interface CustomerTheme {
  key: string;
  name: string;
  description?: string;
  tokens: CustomerThemeTokens;
  metadata?: CustomerThemeMetadata;
}
