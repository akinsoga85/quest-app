import Svg, { Circle, Path } from "react-native-svg";

// Outline icons from the Figma tab bar (24-unit grid, 2-unit stroke).
type IconProps = { color: string; size?: number; strokeWidth?: number };

function Icon({ color, size = 22, strokeWidth = 2, children }: IconProps & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M3 11 12 4l9 7" />
    <Path d="M5 10v10h5v-6h4v6h5V10" />
  </Icon>
);

export const StudioIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" />
    <Path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 5v14M5 12h14" />
  </Icon>
);

export const LevelsIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M4 20h16" />
    <Path d="M7 16v-4M12 16V8M17 16V5" />
  </Icon>
);

export const YouIcon = (p: IconProps) => (
  <Icon {...p}>
    <Circle cx={12} cy={8} r={4} />
    <Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M20 6 9 17l-5-5" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M5 12h14" />
    <Path d="m12 5 7 7-7 7" />
  </Icon>
);

export const FlameIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </Icon>
);

export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z" />
    <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Icon>
);

// Zone icons for the picker (H4) and quest cards.
export const CameraIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
    <Circle cx={12} cy={13} r={3} />
  </Icon>
);

export const ShirtIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
  </Icon>
);

export const PaletteIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z" />
    <Circle cx={13.5} cy={6.5} r={1} />
    <Circle cx={17.5} cy={10.5} r={1} />
    <Circle cx={8.5} cy={7.5} r={1} />
    <Circle cx={6.5} cy={12.5} r={1} />
  </Icon>
);

export const MusicIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M9 18V5l12-2v13" />
    <Circle cx={6} cy={18} r={3} />
    <Circle cx={18} cy={16} r={3} />
  </Icon>
);

export const PenIcon = (p: IconProps) => (
  <Icon {...p}>
    <Path d="M12 20h9" />
    <Path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Icon>
);

export const ZONE_ICONS = {
  photography: CameraIcon,
  fashion: ShirtIcon,
  art_crafts: PaletteIcon,
  music: MusicIcon,
  words: PenIcon,
} as const;
