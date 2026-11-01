import { Platform } from "react-native";
import { storeHasPlus } from "./logic";

// RevenueCat, for buying Plus in the app (App Store and Google Play). The
// store sends the purchase to RevenueCat, which tells our server by webhook
// (packages/payments); the server decides what the teen has. The app only
// buys, restores, and shows the store's price.
//
// Needs EXPO_PUBLIC_REVENUECAT_IOS_KEY / EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
// (RevenueCat's public SDK keys) and a development or store build: the
// native module isn't in Expo Go or on the web.

type Module = typeof import("react-native-purchases");
let loading: Promise<Module | null> | null = null;
let user: string | null = null;

function apiKey(): string | undefined {
  if (Platform.OS === "ios") return process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  if (Platform.OS === "android") return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  return undefined;
}

// RevenueCat knows the teen by their account id, which the webhook maps back.
async function forTeen(teenId: string): Promise<Module | null> {
  const key = apiKey();
  if (!key) return null;
  loading ??= import("react-native-purchases")
    .then((m) => {
      m.default.configure({ apiKey: key, appUserID: teenId });
      user = teenId;
      return m;
    })
    .catch(() => null);
  const m = await loading;
  if (m && user !== teenId) {
    await m.default.logIn(teenId);
    user = teenId;
  }
  return m;
}

export type BuyResult = "bought" | "pending" | "cancelled";

export interface PlusOffer {
  price: string; // the store's own price, in the teen's currency
  buy: () => Promise<BuyResult>;
}

// The monthly Plus subscription from RevenueCat's current offering, or null
// when it can't be bought on this phone right now.
export async function loadOffer(teenId: string): Promise<PlusOffer | null> {
  const m = await forTeen(teenId);
  if (!m) return null;
  const offerings = await m.default.getOfferings();
  const pkg = offerings.current?.monthly ?? offerings.current?.availablePackages[0] ?? null;
  if (!pkg) return null;
  return {
    price: pkg.product.priceString,
    buy: async () => {
      try {
        const r = await m.default.purchasePackage(pkg);
        return storeHasPlus(r.customerInfo.entitlements.active) ? "bought" : "pending";
      } catch (e) {
        const err = e as { userCancelled?: boolean | null; code?: string };
        if (err.userCancelled || err.code === m.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return "cancelled";
        // Ask to Buy, or a payment the store is still processing.
        if (err.code === m.PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return "pending";
        throw e;
      }
    },
  };
}

// Restore purchases (the App Store requires it): finds a subscription bought
// on another phone with the same store account.
export async function restorePlus(teenId: string): Promise<boolean> {
  const m = await forTeen(teenId);
  if (!m) return false;
  const info = await m.default.restorePurchases();
  return storeHasPlus(info.entitlements.active);
}
