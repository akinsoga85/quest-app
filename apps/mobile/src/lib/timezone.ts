import { getCalendars } from "expo-localization";
import { cleanTimeZone } from "../today/logic";

// The phone's IANA time zone, or UTC if it reports something else.
export function deviceTimeZone(): string {
  return cleanTimeZone(getCalendars()[0]?.timeZone);
}
