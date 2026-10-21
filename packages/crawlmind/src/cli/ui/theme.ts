import pc from 'picocolors';

export type Colors = ReturnType<typeof pc.createColors>;

export interface Theme {
  c: Colors;
  sym: {
    ok: string;
    fail: string;
    warn: string;
    info: string;
    critical: string;
    arrow: string;
    dot: string;
  };
}

/** Colors honour --no-color, NO_COLOR, FORCE_COLOR and whether the stream is a terminal. */
export function createTheme(enabled: boolean): Theme {
  const c = pc.createColors(enabled);
  const unicode = process.platform !== 'win32' || Boolean(process.env.WT_SESSION);
  return {
    c,
    sym: unicode
      ? { ok: '✔', fail: '✖', warn: '▲', info: 'ℹ', critical: '●', arrow: '→', dot: '·' }
      : { ok: '√', fail: '×', warn: '!', info: 'i', critical: '*', arrow: '->', dot: '-' },
  };
}
