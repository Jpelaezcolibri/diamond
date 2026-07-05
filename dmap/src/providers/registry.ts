import { facebookAdapter } from "./meta/facebook.adapter.js";
import { instagramAdapter } from "./meta/instagram.adapter.js";
import type { SocialProvider } from "./social-provider.js";
import type { SocialPlatform } from "../repositories/types.js";

/** Plataforma -> adapter. Agregar LinkedIn/Google Business/TikTok es una entrada nueva aqui, nada mas. */
const PROVIDERS: Record<SocialPlatform, SocialProvider> = {
  facebook: facebookAdapter,
  instagram: instagramAdapter
};

export function resolveProvider(platform: SocialPlatform): SocialProvider {
  return PROVIDERS[platform];
}
