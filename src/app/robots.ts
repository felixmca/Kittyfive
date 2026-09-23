/**
 * robots.txt: the stories, the store and the try-on are for everyone; the
 * account, admin and email-link pages and the API are not for search engines.
 */
import type { MetadataRoute } from "next";
import { SITE } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/account", "/admin", "/subscribe/", "/unsubscribe", "/checkout/", "/stories/new", "/stories/*/edit"],
      },
    ],
    sitemap: `${SITE.url.replace(/\/$/, "")}/sitemap.xml`,
  };
}
