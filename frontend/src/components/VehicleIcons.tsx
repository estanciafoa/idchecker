import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

type IconProps = {
  size?: number;
  color?: string;
};

export const AutoRickshawIcon: React.FC<IconProps> = ({ size = 24, color = '#000' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* Curved roof/canopy */}
    <Path
      d="M4 11C4 7 7 5 11 5H16L19 8"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Front pillar */}
    <Path d="M4 11V17" stroke={color} strokeWidth={2} strokeLinecap="round" />
    {/* Rear wall */}
    <Path d="M19 8V17" stroke={color} strokeWidth={2} strokeLinecap="round" />
    {/* Window sill bar */}
    <Path d="M4 11H19" stroke={color} strokeWidth={2} strokeLinecap="round" />
    {/* Door divider */}
    <Path d="M12 8V17" stroke={color} strokeWidth={2} strokeLinecap="round" />
    {/* Bottom line (with gaps for wheels) */}
    <Path d="M4 17H5M9 17H15M19 17H19.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    {/* Front wheel */}
    <Circle cx={7} cy={18.5} r={2} stroke={color} strokeWidth={1.5} />
    <Circle cx={7} cy={18.5} r={0.6} fill={color} />
    {/* Rear wheel */}
    <Circle cx={17} cy={18.5} r={2} stroke={color} strokeWidth={1.5} />
    <Circle cx={17} cy={18.5} r={0.6} fill={color} />
  </Svg>
);

export const TruckIcon: React.FC<IconProps> = ({ size = 24, color = '#000' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* Cab with angled windshield */}
    <Path
      d="M3 17V10L6 7H10V17"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Flat cargo bed */}
    <Path
      d="M10 13H21V17H10"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Bottom line (with gaps for wheels) */}
    <Path d="M3 17H4.5M9.5 17H15M19 17H21" stroke={color} strokeWidth={2} strokeLinecap="round" />
    {/* Front wheel */}
    <Circle cx={7} cy={18.5} r={2} stroke={color} strokeWidth={1.5} />
    <Circle cx={7} cy={18.5} r={0.6} fill={color} />
    {/* Rear wheel */}
    <Circle cx={17} cy={18.5} r={2} stroke={color} strokeWidth={1.5} />
    <Circle cx={17} cy={18.5} r={0.6} fill={color} />
  </Svg>
);
