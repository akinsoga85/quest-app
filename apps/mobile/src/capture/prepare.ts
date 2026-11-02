import { cropTo45, hasPrivateMetadata, jpegMetadata, PHOTO, resizeFor, stripJpegMetadata } from "@quest/contract";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

// Turns a photo from the camera or the photo library into what the app
// uploads: the centred 4:5 crop, at most 1600 px tall, re-encoded as JPEG,
// with every metadata segment removed (PRD R12, R13). Returns the bytes; the
// caller decides where they go.
export async function preparePhoto(uri: string): Promise<Uint8Array> {
  // Load once to get the size the right way up (phones store rotation separately).
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const crop = cropTo45(original.width, original.height);
  const out = await ImageManipulator.manipulate(original).crop(crop).resize(resizeFor(crop)).renderAsync();
  const saved = await out.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO.jpegQuality });
  original.release();
  out.release();

  const file = new File(saved.uri);
  try {
    const clean = stripJpegMetadata(await file.bytes());
    if (hasPrivateMetadata(jpegMetadata(clean))) throw new Error("Couldn't remove the photo's location data.");
    if (clean.length > PHOTO.maxBytes) throw new Error("This photo is too big to upload.");
    return clean;
  } finally {
    if (file.exists) file.delete();
  }
}
