export type DrawingColorTarget = 'brush' | 'fill' | 'outline';
type ScreenColorResult = { status: 'picked'; color: string } | { status: 'unsupported' | 'cancelled' };
type EyeDropperConstructor = new () => { open: (options: { signal: AbortSignal }) => Promise<{ sRGBHex: string }> };

export async function pickScreenColor(signal: AbortSignal): Promise<ScreenColorResult> {
  const EyeDropper = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
  if (!EyeDropper || window.isSecureContext === false) return { status: 'unsupported' };
  try {
    // Call directly from the click/keyboard handler to retain user activation.
    const result = await new EyeDropper().open({ signal });
    if (signal.aborted) return { status: 'cancelled' };
    if (!/^#[0-9a-f]{6}$/i.test(result.sRGBHex)) throw new Error('invalid_screen_color');
    return { status: 'picked', color: result.sRGBHex.toLowerCase() };
  } catch (error) {
    if (signal.aborted || (error as { name?: string })?.name === 'AbortError') return { status: 'cancelled' };
    throw error;
  }
}

export function sampleDrawingColor(canvas: HTMLCanvasElement, x: number, y: number, background: string | null): string | null {
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width || !canvas.height) return null;
  const pixel = ctx.getImageData(
    Math.max(0, Math.min(canvas.width - 1, Math.floor(x * canvas.width))),
    Math.max(0, Math.min(canvas.height - 1, Math.floor(y * canvas.height))), 1, 1,
  ).data;
  if (!pixel[3] && !background) return null;
  const alpha = background ? pixel[3] / 255 : 1;
  const rgb = [pixel[0], pixel[1], pixel[2]].map((value, i) => {
    const base = background ? parseInt(background.slice(1 + i * 2, 3 + i * 2), 16) : 0;
    return Math.round(value * alpha + base * (1 - alpha)).toString(16).padStart(2, '0');
  });
  return `#${rgb.join('')}`;
}
