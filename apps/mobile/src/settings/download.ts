import { Api } from "@quest/contract";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { supabase } from "../lib/supabase";
import { PHOTO_LINK_SECONDS, exportFileName, photoPaths, withPhotoLinks } from "./logic";

// Download my work (H20a): everything the app keeps about the teen, as a JSON
// file with a week-long link to each photo, handed to the share sheet so they
// can save it to Files or send it to themselves.
export async function downloadMyWork(handle: string): Promise<"shared" | "unavailable"> {
  const { data, error } = await supabase.rpc("export_my_data");
  if (error) throw new Error("Couldn't gather your work. Try again in a moment.");
  const exported = Api["account.export"].output.parse(data);

  const paths = photoPaths(exported);
  const links: Record<string, string> = {};
  for (let i = 0; i < paths.length; i += 100) {
    const { data: signed } = await supabase.storage.from("makes").createSignedUrls(paths.slice(i, i + 100), PHOTO_LINK_SECONDS);
    for (const s of signed ?? []) if (s.path && s.signedUrl) links[s.path] = s.signedUrl;
  }

  const file = new File(Paths.cache, exportFileName(handle, exported.exportedAt));
  if (!file.exists) file.create({ overwrite: true });
  await file.write(JSON.stringify(withPhotoLinks(exported, links), null, 2));
  if (!(await Sharing.isAvailableAsync())) return "unavailable";
  await Sharing.shareAsync(file.uri, { mimeType: "application/json", UTI: "public.json", dialogTitle: "Save your work" });
  return "shared";
}
