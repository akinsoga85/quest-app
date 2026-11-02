import * as ImagePicker from "expo-image-picker";

// The system photo picker: on Android it's Google's Photo Picker, so the app
// never asks for access to the whole library and sees only the photo chosen.
// iOS uses PHPicker, which needs no permission either.
export const LIBRARY_OPTIONS = {
  mediaTypes: ["images"],
  allowsMultipleSelection: false,
  allowsEditing: false, // the app crops to 4:5 itself
  legacy: false, // Android: never the old picker that reads all files
  exif: false,
  quality: 1,
} satisfies ImagePicker.ImagePickerOptions;

export async function pickFromLibrary(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync(LIBRARY_OPTIONS);
  if (result.canceled) return null;
  return result.assets[0]?.uri ?? null;
}
