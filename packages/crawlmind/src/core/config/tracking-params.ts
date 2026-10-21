/** Query parameters removed during URL normalization. Prefix entries end with `*`. */
export const TRACKING_PARAMS = [
  'utm_*',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'yclid',
  'ysclid',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'igshid',
] as const;
