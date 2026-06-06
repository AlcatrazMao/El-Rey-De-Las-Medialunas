export const colors = {
  primary: '#8B4513',
  primaryLight: '#A0522D',
  primaryDark: '#6B3410',
  secondary: '#D2691E',
  success: '#228B22',
  warning: '#FF8C00',
  danger: '#DC143C',
  neutral50: '#FFF8DC',
  neutral100: '#FAF0E6',
  neutral200: '#F5DEB3',
  neutral500: '#8B7355',
  neutral900: '#2C1810',
} as const;

export type ColorToken = keyof typeof colors;
