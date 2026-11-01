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
