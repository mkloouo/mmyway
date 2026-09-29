// Receipt photos straight off the camera are several megabytes of base64. The reader doesn't need
// that: the long side is capped at MAX_SIDE before the image is hashed, stored, sent to the model
// and uploaded — faster local parsing, cheaper Gemini calls, less memory.
import { logLine } from '../utils/log';
import { errorMessage } from '../utils/errorMessage';

export const MAX_SIDE = 1600;

/** The image to use instead, or null to keep the original (already small, or resizing failed). */
export async function downscaleReceipt(
  uri: string,
): Promise<{ uri: string; base64: string } | null> {
  try {
    // Lazy: expo-image-manipulator is native-only, and ingest.ts is loaded by Jest.
     
    const { ImageManipulator, SaveFormat } =
      require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    const original = await ImageManipulator.manipulate(uri).renderAsync();
    if (Math.max(original.width, original.height) <= MAX_SIDE) return null;
    const resized = await ImageManipulator.manipulate(uri)
      .resize(original.width >= original.height ? { width: MAX_SIDE } : { height: MAX_SIDE })
      .renderAsync();
    const saved = await resized.saveAsync({
      base64: true,
      compress: 0.85,
      format: SaveFormat.JPEG,
    });
    return saved.base64 ? { uri: saved.uri, base64: saved.base64 } : null;
  } catch (err) {
    logLine('warn', `receipt downscale skipped: ${errorMessage(err)}`);
    return null;
  }
}
